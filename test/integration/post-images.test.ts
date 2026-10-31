import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

/**
 * Cartão E3c — múltiplas fotos por post (atividade 4 do Trabalho II).
 *
 * `Post.imageUrl` virou a relação 1:N `PostImage` (ADR-0009). O que estes
 * testes fixam: um `imageStorage.upload()` por arquivo, `order` preservando a
 * ordem do upload, o limite de 5 e a leitura ordenada nas views.
 */

const prisma: PrismaClient = createTestPrismaClient();
const storage = new FakeImageStorage();
const app = createServer(prisma, storage);

beforeEach(async () => {
  await resetDatabase(prisma);
  storage.uploads.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('POST /posts com várias fotos', () => {
  it('grava uma PostImage por arquivo, na ordem do upload', async () => {
    const { agent, userId } = await registerAndLogin(app, prisma, 'autora@exemplo.com', 'Autora');

    const res = await agent
      .post('/posts')
      .field('content', 'post com três fotos')
      .attach('images', PNG, { filename: 'um.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'dois.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'tres.png', contentType: 'image/png' });

    expect(res.status).toBe(302);
    // um upload() por arquivo — a porta ImageStorage não mudou (ADR-0007)
    expect(storage.uploads.map((f) => f.originalname)).toEqual(['um.png', 'dois.png', 'tres.png']);

    const post = await prisma.post.findFirstOrThrow({
      where: { content: 'post com três fotos' },
      include: { images: { orderBy: { order: 'asc' } } },
    });
    expect(post.authorId).toBe(userId);
    expect(post.images.map((i) => [i.order, i.url])).toEqual([
      [0, 'https://fake-bucket.test/um.png'],
      [1, 'https://fake-bucket.test/dois.png'],
      [2, 'https://fake-bucket.test/tres.png'],
    ]);
  });

  it(`recusa mais de 5 arquivos com 400 e não grava nada`, async () => {
    const { agent } = await registerAndLogin(app, prisma, 'autora@exemplo.com', 'Autora');

    let req = agent.post('/posts').field('content', 'post com seis fotos');
    for (let i = 1; i <= 6; i += 1) {
      req = req.attach('images', PNG, { filename: `foto${i}.png`, contentType: 'image/png' });
    }
    const res = await req;

    expect(res.status).toBe(400);
    expect(await prisma.post.count()).toBe(0);
    expect(await prisma.postImage.count()).toBe(0);
  });

  it('post sem arquivo continua válido e sem fotos', async () => {
    const { agent } = await registerAndLogin(app, prisma, 'autora@exemplo.com', 'Autora');

    const res = await agent.post('/posts').type('form').send({ content: 'post sem foto' });

    expect(res.status).toBe(302);
    const post = await prisma.post.findFirstOrThrow({
      where: { content: 'post sem foto' },
      include: { images: true },
    });
    expect(post.images).toEqual([]);
  });
});

describe('leitura das fotos nas views', () => {
  /** Autor com um post de 2 fotos + seguidor (o feed mostra quem se segue). */
  async function doisSeguidores() {
    const autor = await registerAndLogin(app, prisma, 'autor@exemplo.com', 'Autor');
    await autor.agent
      .post('/posts')
      .field('content', 'post com duas fotos')
      .attach('images', PNG, { filename: 'a.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'b.png', contentType: 'image/png' });
    const post = await prisma.post.findFirstOrThrow({ where: { content: 'post com duas fotos' } });

    const seguidor = await registerAndLogin(app, prisma, 'seguidor@exemplo.com', 'Seguidor');
    await seguidor.agent.post('/follow').type('form').send({ targetId: autor.userId });
    return { autor, seguidor, post };
  }

  it('o feed renderiza o carrossel com as duas fotos (E4)', async () => {
    const { seguidor } = await doisSeguidores();

    const res = await seguidor.agent.get('/');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/data-carousel/);
    expect(res.text).toContain('https://fake-bucket.test/a.png');
    expect(res.text).toContain('https://fake-bucket.test/b.png');
    // duas setas + dois indicadores + contador acessível
    expect(res.text).toMatch(/data-carousel-prev/);
    expect(res.text).toMatch(/data-carousel-next/);
    expect((res.text.match(/data-carousel-dot=/g) ?? []).length).toBe(2);
    expect(res.text).toMatch(/Foto 1 de 2/);
  });

  it('com uma única foto não há carrossel — só a imagem', async () => {
    const autor = await registerAndLogin(app, prisma, 'autor@exemplo.com', 'Autor');
    await autor.agent
      .post('/posts')
      .field('content', 'post com uma foto só')
      .attach('images', PNG, { filename: 'unica.png', contentType: 'image/png' });
    const post = await prisma.post.findFirstOrThrow({ where: { content: 'post com uma foto só' } });

    const res = await autor.agent.get(`/posts/${post.id}`);

    expect(res.text).toContain('https://fake-bucket.test/unica.png');
    expect(res.text).not.toMatch(/data-carousel(?![\w-])/);
  });

  it('a página do post mostra todas as fotos, na ordem', async () => {
    const { autor, post } = await doisSeguidores();

    const res = await autor.agent.get(`/posts/${post.id}`);

    expect(res.status).toBe(200);
    const primeira = res.text.indexOf('https://fake-bucket.test/a.png');
    const segunda = res.text.indexOf('https://fake-bucket.test/b.png');
    expect(primeira).toBeGreaterThan(-1);
    expect(segunda).toBeGreaterThan(primeira);
  });

  it('a API devolve as fotos ordenadas em `images` (e não mais `imageUrl`)', async () => {
    const { post } = await doisSeguidores();

    const res = await request(app).get(`/api/posts/${post.id}`).set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.images.map((i: { order: number }) => i.order)).toEqual([0, 1]);
    expect(res.body).not.toHaveProperty('imageUrl');
  });
});
