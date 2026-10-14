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

describe('POST /users', () => {
  it('cria um usuário', async () => {
    const res = await request(app).post('/users').send({ name: 'Ana', email: 'ana@exemplo.com' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Ana', email: 'ana@exemplo.com' });
  });

  it('rejeita nome ausente', async () => {
    const res = await request(app).post('/users').send({ email: 'ana@exemplo.com' });

    expect(res.status).toBe(400);
  });

  it('rejeita e-mail duplicado', async () => {
    await request(app).post('/users').send({ name: 'Ana', email: 'ana@exemplo.com' });
    const res = await request(app).post('/users').send({ name: 'Outra Ana', email: 'ana@exemplo.com' });

    expect(res.status).toBe(409);
  });
});

describe('GET /users/:id', () => {
  it('retorna 404 para usuário inexistente', async () => {
    const res = await request(app).get('/users/999');

    expect(res.status).toBe(404);
  });

  it('retorna o usuário com contagem de posts, seguidores e seguindo', async () => {
    const created = await request(app).post('/users').send({ name: 'Ana', email: 'ana@exemplo.com' });

    const res = await request(app).get(`/users/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body._count).toEqual({ posts: 0, followers: 0, following: 0 });
  });
});

describe('POST /users/:id/follow (autorrelação N:N)', () => {
  async function createUser(name: string, email: string) {
    const res = await request(app).post('/users').send({ name, email });
    return res.body as { id: number };
  }

  it('permite um usuário seguir outro', async () => {
    const ana = await createUser('Ana', 'ana@exemplo.com');
    const bruno = await createUser('Bruno', 'bruno@exemplo.com');

    const res = await request(app).post(`/users/${ana.id}/follow`).send({ targetId: bruno.id });

    expect(res.status).toBe(204);
  });

  it('rejeita seguir a si mesmo', async () => {
    const ana = await createUser('Ana', 'ana@exemplo.com');

    const res = await request(app).post(`/users/${ana.id}/follow`).send({ targetId: ana.id });

    expect(res.status).toBe(400);
  });

  it('rejeita seguir o mesmo usuário duas vezes', async () => {
    const ana = await createUser('Ana', 'ana@exemplo.com');
    const bruno = await createUser('Bruno', 'bruno@exemplo.com');
    await request(app).post(`/users/${ana.id}/follow`).send({ targetId: bruno.id });

    const res = await request(app).post(`/users/${ana.id}/follow`).send({ targetId: bruno.id });

    expect(res.status).toBe(409);
  });

  it('rejeita seguir usuário inexistente', async () => {
    const ana = await createUser('Ana', 'ana@exemplo.com');

    const res = await request(app).post(`/users/${ana.id}/follow`).send({ targetId: 999 });

    expect(res.status).toBe(404);
  });
});

describe('GET /users/:id/feed', () => {
  it('retorna apenas posts de quem o usuário segue', async () => {
    const anaRes = await request(app).post('/users').send({ name: 'Ana', email: 'ana@exemplo.com' });
    const brunoRes = await request(app).post('/users').send({ name: 'Bruno', email: 'bruno@exemplo.com' });
    const carlaRes = await request(app).post('/users').send({ name: 'Carla', email: 'carla@exemplo.com' });
    const ana = anaRes.body as { id: number };
    const bruno = brunoRes.body as { id: number };
    const carla = carlaRes.body as { id: number };

    await request(app).post(`/users/${ana.id}/follow`).send({ targetId: bruno.id });
    await request(app).post('/posts').send({ authorId: bruno.id, content: 'Post do Bruno' });
    await request(app).post('/posts').send({ authorId: carla.id, content: 'Post da Carla' });

    const res = await request(app).get(`/users/${ana.id}/feed`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toBe('Post do Bruno');
  });
});
