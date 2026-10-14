import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';

const prisma: PrismaClient = createTestPrismaClient();
const app = createServer(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser(name: string, email: string) {
  const res = await request(app).post('/users').send({ name, email });
  return res.body as { id: number };
}

describe('POST /posts', () => {
  it('cria um post com autor (1:N) e tags (N:N)', async () => {
    const author = await createUser('Ana', 'ana@exemplo.com');

    const res = await request(app)
      .post('/posts')
      .send({ authorId: author.id, content: 'Olá, Prisma!', tags: ['prisma', 'orm'] });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe('Olá, Prisma!');
    expect(res.body.author.id).toBe(author.id);
    expect(res.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(['orm', 'prisma']);
  });

  it('reaproveita uma tag já existente em vez de duplicá-la', async () => {
    const author = await createUser('Ana', 'ana@exemplo.com');
    await request(app).post('/posts').send({ authorId: author.id, content: 'Post 1', tags: ['prisma'] });

    await request(app).post('/posts').send({ authorId: author.id, content: 'Post 2', tags: ['prisma'] });

    const res = await request(app).get('/tags/prisma/posts');
    expect(res.body).toHaveLength(2);
  });

  it('rejeita post sem autor existente', async () => {
    const res = await request(app).post('/posts').send({ authorId: 999, content: 'Post órfão' });

    expect(res.status).toBe(404);
  });

  it('rejeita post sem conteúdo', async () => {
    const author = await createUser('Ana', 'ana@exemplo.com');

    const res = await request(app).post('/posts').send({ authorId: author.id, content: '' });

    expect(res.status).toBe(400);
  });
});

describe('GET /posts/:id', () => {
  it('retorna 404 para post inexistente', async () => {
    const res = await request(app).get('/posts/999');

    expect(res.status).toBe(404);
  });

  it('retorna o post com autor e tags', async () => {
    const author = await createUser('Ana', 'ana@exemplo.com');
    const created = await request(app)
      .post('/posts')
      .send({ authorId: author.id, content: 'Olá, Prisma!', tags: ['prisma'] });

    const res = await request(app).get(`/posts/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.author.name).toBe('Ana');
    expect(res.body.tags[0].name).toBe('prisma');
  });
});

describe('GET /tags/:name/posts', () => {
  it('retorna 404 para tag inexistente', async () => {
    const res = await request(app).get('/tags/inexistente/posts');

    expect(res.status).toBe(404);
  });
});
