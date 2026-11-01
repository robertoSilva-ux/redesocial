import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

/**
 * Item 10 do Trabalho II — contador de "novas curtidas/comentários desde seu
 * último acesso", calculado a partir de `createdAt` (ADR-0012).
 *
 * O número vem derivado do banco (`count()` com `createdAt > lastSeenAt`), não
 * de um contador materializado: por isso o que os testes precisam provar é o
 * **critério** (o que conta e o que não conta) e o **momento do reset**.
 */

const prisma: PrismaClient = createTestPrismaClient();
const app = createServer(prisma, new FakeImageStorage());

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Autor com um post publicado; devolve também `outro` (quem gera a novidade). */
async function cenario() {
  const autor = await registerAndLogin(app, prisma, 'autor@exemplo.com', 'Autor');
  await autor.agent.post('/posts').type('form').send({ content: 'post do autor' });
  const post = await prisma.post.findFirstOrThrow({ where: { content: 'post do autor' } });

  const outro = await registerAndLogin(app, prisma, 'outro@exemplo.com', 'Outro');

  return { autor, outro, post };
}

/** Fixa o corte: tudo que existir depois disso é "novo". */
async function marcarAcesso(userId: number, quando: Date) {
  await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: quando } });
}

function selo(html: string): number | null {
  const m = html.match(/data-news-count="(\d+)"/);
  return m ? Number(m[1]) : null;
}

describe('selo de novidades no feed', () => {
  it('primeiro acesso: sem `lastSeenAt` não há novidade — e o acesso passa a contar', async () => {
    const { autor, outro, post } = await cenario();
    // Atividade existe ANTES do primeiro acesso.
    await outro.agent.post(`/posts/${post.id}/like`).set('Accept', 'application/json');

    const res = await autor.agent.get('/');

    expect(res.status).toBe(200);
    expect(selo(res.text)).toBeNull(); // zero novidades → sem selo
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: autor.userId } });
    expect(depois.lastSeenAt).not.toBeNull(); // o acesso marcou o corte
  });

  it('conta curtida de terceiro no meu post e mostra o número — e a carga seguinte zera', async () => {
    const { autor, outro, post } = await cenario();
    await autor.agent.get('/'); // primeiro acesso: marca o corte
    await marcarAcesso(autor.userId, new Date(Date.now() - 60_000));

    await outro.agent.post(`/posts/${post.id}/like`).set('Accept', 'application/json');

    const primeira = await autor.agent.get('/');
    const segunda = await autor.agent.get('/');

    expect(selo(primeira.text)).toBe(1);
    expect(selo(segunda.text)).toBeNull(); // já consumido
  });

  it('conta comentário de terceiro e curtida de terceiro no meu comentário', async () => {
    const { autor, outro, post } = await cenario();
    await marcarAcesso(autor.userId, new Date(Date.now() - 60_000));

    const meuComentario = await autor.agent
      .post(`/posts/${post.id}/comments`)
      .set('Accept', 'application/json')
      .send({ content: 'comentário do autor' });

    await outro.agent.post(`/posts/${post.id}/comments`).set('Accept', 'application/json').send({ content: 'oi' });
    await outro.agent
      .post(`/comments/${meuComentario.body.id}/like`)
      .set('Accept', 'application/json');

    const res = await autor.agent.get('/');

    // 1 comentário + 1 curtida no meu comentário
    expect(selo(res.text)).toBe(2);
    expect(res.text).toMatch(/1 curtida e 1 comentário desde seu último acesso/);
  });

  it('não conta a minha própria atividade', async () => {
    const { autor, post } = await cenario();
    await marcarAcesso(autor.userId, new Date(Date.now() - 60_000));

    // Curtir o próprio post e comentar no próprio post não geram novidade.
    await autor.agent.post(`/posts/${post.id}/like`).set('Accept', 'application/json');
    await autor.agent.post(`/posts/${post.id}/comments`).set('Accept', 'application/json').send({ content: 'eu mesmo' });

    const res = await autor.agent.get('/');

    expect(selo(res.text)).toBeNull();
  });

  it('atividade anterior ao corte não conta', async () => {
    const { autor, outro, post } = await cenario();
    await outro.agent.post(`/posts/${post.id}/like`).set('Accept', 'application/json');

    // O acesso é DEPOIS da curtida: ela já foi vista.
    await marcarAcesso(autor.userId, new Date(Date.now() + 1_000));

    const res = await autor.agent.get('/');

    expect(selo(res.text)).toBeNull();
  });

  it('ler a página do post NÃO consome as novidades', async () => {
    const { autor, outro, post } = await cenario();
    const corte = new Date(Date.now() - 60_000);
    await marcarAcesso(autor.userId, corte);
    await outro.agent.post(`/posts/${post.id}/like`).set('Accept', 'application/json');

    const postPage = await autor.agent.get(`/posts/${post.id}`);
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: autor.userId } });
    const feed = await autor.agent.get('/');

    expect(selo(postPage.text)).toBe(1); // aparece na página do post...
    expect(depois.lastSeenAt?.getTime()).toBe(corte.getTime()); // ...sem zerar
    expect(selo(feed.text)).toBe(1); // e continua no feed
  });

  it('o selo não vaza para quem não é dono do post', async () => {
    const { outro, post, autor } = await cenario();
    await marcarAcesso(autor.userId, new Date(Date.now() - 60_000));
    await outro.agent.post(`/posts/${post.id}/like`).set('Accept', 'application/json');
    await marcarAcesso(outro.userId, new Date(Date.now() - 60_000));

    const res = await outro.agent.get('/');

    // A curtida é DELE no post do autor: para ele não é novidade.
    expect(selo(res.text)).toBeNull();
  });

  it('sem sessão o feed continua redirecionando (nada de contador anônimo)', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
