import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';

const prisma: PrismaClient = createTestPrismaClient();
const app = createServer(prisma, new FakeImageStorage());

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// As listagens paginadas devolvem JSON; sem `Accept: application/json` o
// errorHandler responde HTML (ver src/shared/errorHandler.ts), então os
// casos de erro pedem JSON explicitamente.
const asJson = { Accept: 'application/json' };

async function createUser(index: number) {
  return prisma.user.create({
    data: {
      name: `Usuário ${index}`,
      email: `usuario${index}@exemplo.com`,
      // obrigatório desde a Aula 05 (bcrypt) — irrelevante aqui
      passwordHash: 'hash-de-teste',
    },
  });
}

async function createPosts(authorId: number, howMany: number) {
  for (let i = 1; i <= howMany; i++) {
    await prisma.post.create({ data: { content: `post ${i}`, authorId } });
  }
}

describe('GET /api/posts (listagem paginada)', () => {
  it('devolve 10 itens por página com metadados completos', async () => {
    const author = await createUser(1);
    await createPosts(author.id, 12);

    const res = await request(app).get('/api/posts');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta).toEqual({
      page: 1,
      pageSize: 10,
      total: 12,
      totalPages: 2,
      hasNext: true,
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it('a página 2 traz o restante e hasNext fica false', async () => {
    const author = await createUser(1);
    await createPosts(author.id, 12);

    const page2 = await request(app).get('/api/posts?page=2');

    expect(page2.body.data).toHaveLength(2);
    expect(page2.body.meta.page).toBe(2);
    expect(page2.body.meta.hasNext).toBe(false);

    // sem desempate no orderBy, itens de createdAt igual (resolução de 1s no
    // SQLite) poderiam repetir entre as páginas
    const page1 = await request(app).get('/api/posts');
    const ids = [...page1.body.data, ...page2.body.data].map((p: { id: number }) => p.id);
    expect(new Set(ids).size).toBe(12);
  });

  it('respeita pageSize e recalcula totalPages', async () => {
    const author = await createUser(1);
    await createPosts(author.id, 12);

    const res = await request(app).get('/api/posts?pageSize=5&page=3');

    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.totalPages).toBe(3);
  });

  it('ordena por createdAt em ordem crescente e decrescente', async () => {
    const author = await createUser(1);
    await createPosts(author.id, 3);

    const asc = await request(app).get('/api/posts?order=asc');
    const desc = await request(app).get('/api/posts?order=desc');

    expect(asc.body.data[0].content).toBe('post 1');
    expect(desc.body.data[0].content).toBe('post 3');
  });

  it('ordena por um campo permitido diferente do padrão (id)', async () => {
    const author = await createUser(1);
    await createPosts(author.id, 3);

    const res = await request(app).get('/api/posts?sort=id&order=asc');

    expect(res.body.meta.sort).toBe('id');
    expect(res.body.data[0].id).toBeLessThan(res.body.data[2].id);
  });

  it('página além do fim devolve lista vazia, mas mantém o total', async () => {
    const author = await createUser(1);
    await createPosts(author.id, 12);

    const res = await request(app).get('/api/posts?page=99');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(12);
    expect(res.body.meta.hasNext).toBe(false);
  });

  it('rejeita parâmetros inválidos com 400 e diz quais campos pode ordenar', async () => {
    const casos = [
      '/api/posts?page=0',
      '/api/posts?page=abc',
      '/api/posts?page=-1',
      '/api/posts?pageSize=0',
      '/api/posts?pageSize=101',
      '/api/posts?pageSize=dez',
      '/api/posts?sort=senha',
      '/api/posts?order=sideways',
    ];

    for (const url of casos) {
      const res = await request(app).get(url).set(asJson);
      expect(res.status, `esperava 400 para ${url}`).toBe(400);
    }

    const semCampoValido = await request(app).get('/api/posts?sort=senha').set(asJson);
    expect(semCampoValido.body.error).toMatch(/createdAt/);
  });
});

describe('GET /api/comments, /likes, /profiles, /images', () => {
  it('GET /api/comments pagina e traz autor e post de cada comentário', async () => {
    const author = await createUser(1);
    const post = await prisma.post.create({ data: { content: 'post', authorId: author.id } });
    for (let i = 1; i <= 12; i++) {
      await prisma.comment.create({ data: { content: `c${i}`, authorId: author.id, postId: post.id } });
    }

    const page1 = await request(app).get('/api/comments');
    const page2 = await request(app).get('/api/comments?page=2');

    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(10);
    expect(page1.body.meta.total).toBe(12);
    expect(page1.body.data[0].author.name).toBe('Usuário 1');
    expect(page1.body.data[0].postId).toBe(post.id);
    expect(page2.body.data).toHaveLength(2);
  });

  it('GET /api/likes pagina e mostra o alvo exclusivo de cada like', async () => {
    const post = await prisma.post.create({
      data: { content: 'post', authorId: (await createUser(1)).id },
    });
    for (let i = 2; i <= 13; i++) {
      const user = await createUser(i);
      await prisma.like.create({ data: { userId: user.id, postId: post.id } });
    }

    const res = await request(app).get('/api/likes');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta.total).toBe(12);
    expect(res.body.data[0]).toMatchObject({ postId: post.id });
  });

  it('GET /api/profiles pagina e permite ordenar por displayName', async () => {
    for (let i = 1; i <= 12; i++) {
      const user = await createUser(i);
      await prisma.userProfile.create({
        data: { userId: user.id, displayName: `perfil ${String(i).padStart(2, '0')}` },
      });
    }

    const asc = await request(app).get('/api/profiles?sort=displayName&order=asc');
    const desc = await request(app).get('/api/profiles?sort=displayName&order=desc');

    expect(asc.status).toBe(200);
    expect(asc.body.data[0].displayName).toBe('perfil 01');
    expect(asc.body.meta.total).toBe(12);
    expect(desc.body.data[0].displayName).toBe('perfil 12');
  });

  it('GET /api/images pagina e traz o dono da imagem', async () => {
    const owner = await createUser(1);
    for (let i = 1; i <= 12; i++) {
      await prisma.image.create({ data: { url: `https://exemplo.com/${i}.png`, ownerId: owner.id } });
    }

    const res = await request(app).get('/api/images?pageSize=12');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.meta.total).toBe(12);
    expect(res.body.data[0].owner.name).toBe('Usuário 1');
  });
});

// As rotas abaixo vieram do material da Aula 05 e continuam no formato
// antigo (array puro, ordem fixa). O envelope paginado é só das listagens
// de entidade acima — testado de propósito, para o contrato não mudar sem
// alguém decidir por isso.
describe('rotas de leitura da Aula 05 (formato antigo, sem envelope)', () => {
  it('GET /api/users/:id/feed devolve array de posts', async () => {
    const ana = await createUser(1);
    const bruno = await createUser(2);
    await prisma.follow.create({ data: { followerId: ana.id, followingId: bruno.id } });
    await createPosts(bruno.id, 3);

    const res = await request(app).get(`/api/users/${ana.id}/feed`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
  });

  it('GET /api/tags/:name/posts devolve array de posts', async () => {
    const author = await createUser(1);
    await prisma.post.create({
      data: {
        content: 'post com tag',
        authorId: author.id,
        tags: { connectOrCreate: [{ where: { name: 'prisma' }, create: { name: 'prisma' } }] },
      },
    });

    const res = await request(app).get('/api/tags/prisma/posts');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toBe('post com tag');
  });

  it('mantém o 404 quando a tag ou o usuário não existem', async () => {
    const semTag = await request(app).get('/api/tags/inexistente/posts').set(asJson);
    const semUser = await request(app).get('/api/users/999/feed').set(asJson);

    expect(semTag.status).toBe(404);
    expect(semUser.status).toBe(404);
  });
});
