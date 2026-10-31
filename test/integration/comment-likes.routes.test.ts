import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

/**
 * Cartão E2a — curtida em comentário (atividade 3 do Trabalho II).
 *
 * Não há migração: a tabela `Like` é a mesma do post e já aceita `commentId`,
 * com alvo exclusivo garantido por CHECK (ADR-0002). O que estes testes
 * precisam provar é que a contagem e o estado são **por alvo** — curtir um
 * comentário não pode mexer no número de curtidas do post.
 */

const prisma: PrismaClient = createTestPrismaClient();
const app = createServer(prisma, new FakeImageStorage());

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const asJson = { Accept: 'application/json' };

/** Post do autor + um comentário nele; devolve os dois usuários logados. */
async function cenario() {
  const autor = await registerAndLogin(app, prisma, 'autor@exemplo.com', 'Autor');
  await autor.agent.post('/posts').type('form').send({ content: 'post do autor' });
  const post = await prisma.post.findFirstOrThrow({ where: { content: 'post do autor' } });
  const criado = await autor.agent
    .post(`/posts/${post.id}/comments`)
    .set(asJson)
    .send({ content: 'comentário do autor' });

  const leitor = await registerAndLogin(app, prisma, 'leitor@exemplo.com', 'Leitor');
  return { autor, leitor, post, comentario: criado.body };
}

describe('POST /comments/:id/like (alterna)', () => {
  it('curte e devolve o estado novo; curtir de novo descurte', async () => {
    const { leitor, comentario } = await cenario();

    const curtir = await leitor.agent.post(`/comments/${comentario.id}/like`).set(asJson);
    expect(curtir.status).toBe(200);
    expect(curtir.body).toEqual({ liked: true, likeCount: 1 });

    const descurtir = await leitor.agent.post(`/comments/${comentario.id}/like`).set(asJson);
    expect(descurtir.body).toEqual({ liked: false, likeCount: 0 });
    expect(await prisma.like.count()).toBe(0);
  });

  it('dois usuários somam na contagem e cada um vê o seu estado', async () => {
    const { autor, leitor, comentario } = await cenario();

    await leitor.agent.post(`/comments/${comentario.id}/like`).set(asJson);
    const doAutor = await autor.agent.post(`/comments/${comentario.id}/like`).set(asJson);

    expect(doAutor.body).toEqual({ liked: true, likeCount: 2 });
    // Um like por usuário: o autor curtiu o comentário do próprio autor, não "duplicou" o do leitor.
    expect(await prisma.like.count({ where: { commentId: comentario.id } })).toBe(2);
  });

  it('a contagem é por alvo: curtir o comentário não altera a do post', async () => {
    const { leitor, post, comentario } = await cenario();

    await leitor.agent.post(`/posts/${post.id}/like`).set(asJson);
    await leitor.agent.post(`/comments/${comentario.id}/like`).set(asJson);

    const estadoPost = await leitor.agent.post(`/posts/${post.id}/like`).set(asJson); // alterna: descurte
    expect(estadoPost.body).toEqual({ liked: false, likeCount: 0 });

    const estadoComentario = await leitor.agent.delete(`/comments/${comentario.id}/like`);
    expect(estadoComentario.body).toEqual({ liked: false, likeCount: 0 });

    // E cada like conta em um lugar só (o CHECK impede os dois alvos).
    expect(await prisma.like.count()).toBe(0);
  });

  it('sem sessão redireciona para /login', async () => {
    const { comentario } = await cenario();

    const res = await request(app).post(`/comments/${comentario.id}/like`).set(asJson);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('comentário inexistente → 404 · id malformado → 400', async () => {
    const { leitor } = await cenario();

    const inexistente = await leitor.agent.post('/comments/999999/like').set(asJson);
    const malformado = await leitor.agent.post('/comments/abc/like').set(asJson);

    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error).toMatch(/Comentário 999999 não encontrado/);
    expect(malformado.status).toBe(400);
  });

  it('sem JavaScript (formulário) volta para a página anterior', async () => {
    const { leitor, post, comentario } = await cenario();

    const res = await leitor.agent
      .post(`/comments/${comentario.id}/like`)
      .set('Referer', `/posts/${post.id}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/posts/${post.id}`);
    expect(await prisma.like.count({ where: { commentId: comentario.id } })).toBe(1);
  });
});

describe('DELETE /comments/:id/like (idempotente)', () => {
  it('descurte e repetir não é erro', async () => {
    const { leitor, comentario } = await cenario();
    await leitor.agent.post(`/comments/${comentario.id}/like`).set(asJson);

    const primeiro = await leitor.agent.delete(`/comments/${comentario.id}/like`);
    const segundo = await leitor.agent.delete(`/comments/${comentario.id}/like`);

    expect(primeiro.body).toEqual({ liked: false, likeCount: 0 });
    expect(segundo.status).toBe(200);
    expect(segundo.body).toEqual({ liked: false, likeCount: 0 });
  });
});
