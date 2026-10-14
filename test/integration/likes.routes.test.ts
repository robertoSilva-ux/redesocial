import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

const prisma: PrismaClient = createTestPrismaClient();
const app = createServer(prisma, new FakeImageStorage());

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const asJson = { Accept: 'application/json' };

// Publicar usa a rota HTML (multipart/urlencoded) e devolve redirect; o id
// do post é lido do banco pelo conteúdo, como o teste do material faz.
async function createPost(agent: ReturnType<typeof request.agent>, content: string) {
  await agent.post('/posts').type('form').send({ content });
  const post = await prisma.post.findFirstOrThrow({ where: { content } });
  return post.id;
}

async function setup(email: string) {
  const { agent, userId } = await registerAndLogin(app, prisma, email);
  const postId = await createPost(agent, `post de ${email}`);
  return { agent, userId, postId };
}

describe('POST /posts/:id/like (curtir/descurtir pelo formulário ou fetch)', () => {
  it('sem sessão, redireciona para /login (requireAuth)', async () => {
    const autor = await setup('autor@exemplo.com');

    const res = await request(app).post(`/posts/${autor.postId}/like`).set(asJson);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('curte e devolve o estado novo em JSON', async () => {
    const autor = await setup('autor@exemplo.com');
    const visitante = await registerAndLogin(app, prisma, 'visitante@exemplo.com');

    const res = await visitante.agent
      .post(`/posts/${autor.postId}/like`)
      .set(asJson);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ liked: true, likeCount: 1 });
  });

  it('curtir de novo descurte (a mesma rota alterna)', async () => {
    const autor = await setup('autor@exemplo.com');
    const visitante = await registerAndLogin(app, prisma, 'visitante@exemplo.com');

    await visitante.agent.post(`/posts/${autor.postId}/like`).set(asJson);
    const res = await visitante.agent.post(`/posts/${autor.postId}/like`).set(asJson);

    expect(res.body).toEqual({ liked: false, likeCount: 0 });
    expect(await prisma.like.count()).toBe(0);
  });

  it('dois usuários somam na contagem (e o like é por usuário)', async () => {
    const autor = await setup('autor@exemplo.com');
    const um = await registerAndLogin(app, prisma, 'um@exemplo.com');
    const dois = await registerAndLogin(app, prisma, 'dois@exemplo.com');

    await um.agent.post(`/posts/${autor.postId}/like`).set(asJson);
    const res = await dois.agent.post(`/posts/${autor.postId}/like`).set(asJson);

    expect(res.body).toEqual({ liked: true, likeCount: 2 });
  });

  it('não deixa curtir o mesmo post duas vezes pelo mesmo usuário', async () => {
    const autor = await setup('autor@exemplo.com');
    const visitante = await registerAndLogin(app, prisma, 'visitante@exemplo.com');

    await visitante.agent.post(`/posts/${autor.postId}/like`).set(asJson);
    await visitante.agent.post(`/posts/${autor.postId}/like`).set(asJson);

    expect(await prisma.like.count({ where: { postId: autor.postId } })).toBe(0);
  });

  it('404 quando o post não existe', async () => {
    const visitante = await registerAndLogin(app, prisma, 'visitante@exemplo.com');

    const res = await visitante.agent.post('/posts/99999/like').set(asJson);

    expect(res.status).toBe(404);
  });

  it('sem JavaScript (Accept html) volta para de onde veio', async () => {
    const autor = await setup('autor@exemplo.com');
    const visitante = await registerAndLogin(app, prisma, 'visitante@exemplo.com');

    const res = await visitante.agent
      .post(`/posts/${autor.postId}/like`)
      .set('Accept', 'text/html')
      .set('Referer', '/');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(await prisma.like.count({ where: { postId: autor.postId } })).toBe(1);
  });
});

describe('DELETE /posts/:id/like (sentido único, idempotente)', () => {
  it('descurte e repetir não é erro', async () => {
    const autor = await setup('autor@exemplo.com');
    const visitante = await registerAndLogin(app, prisma, 'visitante@exemplo.com');
    await visitante.agent.post(`/posts/${autor.postId}/like`).set(asJson);

    const primeira = await visitante.agent.delete(`/posts/${autor.postId}/like`).set(asJson);
    const segunda = await visitante.agent.delete(`/posts/${autor.postId}/like`).set(asJson);

    expect(primeira.body).toEqual({ liked: false, likeCount: 0 });
    expect(segunda.status).toBe(200);
    expect(segunda.body).toEqual({ liked: false, likeCount: 0 });
  });
});

describe('feed com as contagens que a view lê', () => {
  it('devolve _count.likes, _count.comments e likedByMe por post', async () => {
    const autor = await setup('autor@exemplo.com');
    const visitante = await registerAndLogin(app, prisma, 'visitante@exemplo.com');
    // o visitante segue o autor, senão o post não entra no feed dele
    await visitante.agent.post('/follow').type('form').send({ targetId: autor.userId });

    await visitante.agent.post(`/posts/${autor.postId}/like`).set(asJson);

    const res = await request(app)
      .get(`/api/users/${visitante.userId}/feed`)
      .set(asJson);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]._count).toMatchObject({ likes: 1, comments: 0 });
    expect(res.body[0].likedByMe).toBe(true);
  });

  it('likedByMe é falso para quem não curtiu', async () => {
    const autor = await setup('autor@exemplo.com');
    const outro = await registerAndLogin(app, prisma, 'outro@exemplo.com');
    await outro.agent.post('/follow').type('form').send({ targetId: autor.userId });

    const res = await request(app).get(`/api/users/${outro.userId}/feed`).set(asJson);

    expect(res.body[0].likedByMe).toBe(false);
    expect(res.body[0]._count).toEqual({ likes: 0, comments: 0 });
  });
});

// Referência de tipos para o helper importado (evita 'unused import' em lint).
export type { Express };
