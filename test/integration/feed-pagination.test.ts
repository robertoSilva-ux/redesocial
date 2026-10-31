import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { FEED_PAGE_SIZE } from '../../src/users/UserController.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

/**
 * Cartão E5b — feed paginado por cursor, devolvendo FRAGMENTO HTML (ADR-0010).
 *
 * O que precisa ser provado: duas páginas consecutivas não repetem nem omitem
 * post (o motivo de cursor em vez de offset), o cursor vai no header
 * `X-Next-Cursor`, e o fragmento tem o mesmo markup do card da primeira página.
 */

const prisma: PrismaClient = createTestPrismaClient();
const app = createServer(prisma, new FakeImageStorage());

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Autor com N posts + seguidor (o feed mostra posts de quem se segue).
 * Metade dos posts compartilha o MESMO `createdAt` de propósito: é o caso em
 * que o desempate por `id` decide, e onde um cursor só com data quebraria.
 */
async function cenario(total = 12) {
  const autor = await registerAndLogin(app, prisma, 'autor@exemplo.com', 'Autor');
  const base = new Date('2026-10-31T12:00:00.000Z');

  for (let i = 0; i < total; i += 1) {
    // 3 posts por segundo → empatam de três em três
    const createdAt = new Date(base.getTime() + Math.floor(i / 3) * 1000);
    await prisma.post.create({ data: { content: `post ${i}`, authorId: autor.userId, createdAt } });
  }

  const seguidor = await registerAndLogin(app, prisma, 'seguidor@exemplo.com', 'Seguidor');
  await seguidor.agent.post('/follow').type('form').send({ targetId: autor.userId });

  const todos = await prisma.post.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });

  return { autor, seguidor, idsNaOrdem: todos.map((p) => p.id) };
}

describe('GET / — primeira página informa o cursor', () => {
  it('renderiza uma página e deixa o cursor no sentinela', async () => {
    const { seguidor } = await cenario();

    const res = await seguidor.agent.get('/');

    expect(res.status).toBe(200);
    expect((res.text.match(/<article/g) ?? []).length).toBe(FEED_PAGE_SIZE);
    const cursor = res.text.match(/id="feed-sentinel"\s+data-next-cursor="([^"]+)"/);
    expect(cursor?.[1]).toBeTruthy();
  });

  it('com menos posts que a página, o sentinela vem vazio (fim da lista)', async () => {
    const { seguidor } = await cenario(3);

    const res = await seguidor.agent.get('/');

    expect((res.text.match(/<article/g) ?? []).length).toBe(3);
    expect(res.text).toMatch(/data-next-cursor=""/);
  });
});

describe('GET /feed/more — fragmento HTML do próximo lote', () => {
  it('devolve HTML, o resto dos posts e o cursor do lote seguinte', async () => {
    const { seguidor } = await cenario();

    const primeira = await seguidor.agent.get('/');
    const cursor = primeira.text.match(/data-next-cursor="([^"]+)"/)![1];

    const segunda = await seguidor.agent.get(`/feed/more?cursor=${encodeURIComponent(cursor)}`);

    expect(segunda.status).toBe(200);
    expect(segunda.headers['content-type']).toMatch(/html/);
    expect((segunda.text.match(/<article/g) ?? []).length).toBe(2);
    expect(segunda.headers['x-next-cursor']).toBeUndefined(); // acabou
    // é fragmento: nada de <html>/<body>
    expect(segunda.text).not.toMatch(/<html/i);
    expect(segunda.text).toMatch(/data-post-id=/);
  });

  it('duas páginas consecutivas não repetem nem omitem post', async () => {
    const { seguidor, idsNaOrdem } = await cenario();

    const primeira = await seguidor.agent.get('/');
    const cursor = primeira.text.match(/data-next-cursor="([^"]+)"/)![1];
    const segunda = await seguidor.agent.get(`/feed/more?cursor=${encodeURIComponent(cursor)}`);

    // Só o `data-post-id` do <article> interessa: o formulário de curtida tem o
    // mesmo atributo, e casar os dois duplicava cada id na leitura.
    const ids = (html: string) =>
      Array.from(html.matchAll(/<article[^>]*data-post-id="(\d+)"/g)).map((m) => Number(m[1]));

    expect([...ids(primeira.text), ...ids(segunda.text)]).toEqual(idsNaOrdem);
  });

  it('respeita limit e informa o próximo cursor quando ainda há mais', async () => {
    const { seguidor } = await cenario();

    const res = await seguidor.agent.get('/feed/more?limit=5');

    expect((res.text.match(/<article/g) ?? []).length).toBe(5);
    expect(res.headers['x-next-cursor']).toBeTruthy();
  });

  it('sem sessão redireciona para /login', async () => {
    const res = await request(app).get('/feed/more');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('cursor inválido → 400 (não 500 nem página em branco)', async () => {
    const { seguidor } = await cenario();

    const res = await seguidor.agent.get('/feed/more?cursor=nao-e-cursor');

    expect(res.status).toBe(400);
  });
});
