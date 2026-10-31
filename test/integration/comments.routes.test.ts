import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { MAX_COMMENT_LENGTH } from '../../src/comments/CommentController.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

/**
 * Cartão E1a — atividade 2 do Trabalho II: comentários em post.
 *
 * O que estes testes precisam provar (critério de rubrica): caminho feliz e
 * pelo menos um caminho de erro por rota, e que a autoria vem da SESSÃO —
 * nunca do corpo da requisição.
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

/** Autor com um post, e um segundo usuário (leitor) já logado. */
async function cenario() {
  const autor = await registerAndLogin(app, prisma, 'autor@exemplo.com', 'Autor');
  await autor.agent.post('/posts').type('form').send({ content: 'post do autor' });
  const post = await prisma.post.findFirstOrThrow({ where: { content: 'post do autor' } });
  const leitor = await registerAndLogin(app, prisma, 'leitor@exemplo.com', 'Leitor');
  return { autor, leitor, post };
}

describe('POST /posts/:id/comments (criar)', () => {
  it('cria o comentário e devolve 201 com autor público', async () => {
    const { leitor, post } = await cenario();

    const res = await leitor.agent
      .post(`/posts/${post.id}/comments`)
      .set(asJson)
      .send({ content: '  primeiro comentário  ' });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe('primeiro comentário'); // trim aplicado
    expect(res.body.postId).toBe(post.id);
    expect(res.body.author).toMatchObject({ id: leitor.userId, name: 'Leitor' });
    expect(res.body._count).toEqual({ likes: 0, replies: 0 });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('a autoria vem da sessão, não do corpo (authorId é ignorado)', async () => {
    const { autor, leitor, post } = await cenario();

    const res = await leitor.agent
      .post(`/posts/${post.id}/comments`)
      .set(asJson)
      .send({ content: 'tentando me passar pelo autor', authorId: autor.userId });

    expect(res.status).toBe(201);
    expect(res.body.authorId).toBe(leitor.userId);
  });

  it('sem sessão redireciona para /login (requireAuth)', async () => {
    const { post } = await cenario();

    const res = await request(app)
      .post(`/posts/${post.id}/comments`)
      .set(asJson)
      .send({ content: 'anônimo' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('conteúdo vazio ou só espaços → 400', async () => {
    const { leitor, post } = await cenario();

    for (const content of ['', '   ', undefined]) {
      const res = await leitor.agent
        .post(`/posts/${post.id}/comments`)
        .set(asJson)
        .send({ content });

      expect(res.status, `conteúdo ${JSON.stringify(content)}`).toBe(400);
    }
    expect(await prisma.comment.count()).toBe(0);
  });

  it('conteúdo acima do limite → 400', async () => {
    const { leitor, post } = await cenario();

    const res = await leitor.agent
      .post(`/posts/${post.id}/comments`)
      .set(asJson)
      .send({ content: 'x'.repeat(MAX_COMMENT_LENGTH + 1) });

    expect(res.status).toBe(400);
    expect(await prisma.comment.count()).toBe(0);
  });

  it('post inexistente → 404 e nada gravado', async () => {
    const { leitor } = await cenario();

    const res = await leitor.agent
      .post('/posts/999999/comments')
      .set(asJson)
      .send({ content: 'comentário órfão' });

    expect(res.status).toBe(404);
    expect(await prisma.comment.count()).toBe(0);
  });

  it('id malformado → 400 (não 500 do Prisma)', async () => {
    const { leitor } = await cenario();

    const res = await leitor.agent.post('/posts/abc/comments').set(asJson).send({ content: 'oi' });

    expect(res.status).toBe(400);
  });

  it('sem JavaScript (formulário) volta para a página do post', async () => {
    const { leitor, post } = await cenario();

    const res = await leitor.agent
      .post(`/posts/${post.id}/comments`)
      .type('form')
      .send({ content: 'comentário sem JS' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/posts/${post.id}`);
    expect(await prisma.comment.count()).toBe(1);
  });
});

describe('GET /posts/:id/comments (listar)', () => {
  it('devolve envelope paginado, só dos comentários daquele post, em ordem cronológica', async () => {
    const { autor, leitor, post } = await cenario();
    const outroPost = await (async () => {
      await autor.agent.post('/posts').type('form').send({ content: 'segundo post' });
      return prisma.post.findFirstOrThrow({ where: { content: 'segundo post' } });
    })();

    await leitor.agent.post(`/posts/${post.id}/comments`).set(asJson).send({ content: 'antigo' });
    await leitor.agent.post(`/posts/${post.id}/comments`).set(asJson).send({ content: 'recente' });
    await leitor.agent.post(`/posts/${outroPost.id}/comments`).set(asJson).send({ content: 'de outro post' });

    const res = await request(app).get(`/posts/${post.id}/comments`).set(asJson);

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 10, total: 2, sort: 'createdAt', order: 'asc' });
    expect(res.body.data.map((c: { content: string }) => c.content)).toEqual(['antigo', 'recente']);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('respeita pageSize e informa hasNext', async () => {
    const { leitor, post } = await cenario();
    for (const texto of ['um', 'dois', 'três']) {
      await leitor.agent.post(`/posts/${post.id}/comments`).set(asJson).send({ content: texto });
    }

    const res = await request(app).get(`/posts/${post.id}/comments?pageSize=2`).set(asJson);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ total: 3, totalPages: 2, hasNext: true });
  });

  it('post inexistente → 404 · id malformado → 400', async () => {
    const inexistente = await request(app).get('/posts/999999/comments').set(asJson);
    const malformado = await request(app).get('/posts/abc/comments').set(asJson);

    expect(inexistente.status).toBe(404);
    expect(malformado.status).toBe(400);
  });
});

describe('DELETE /comments/:id (apagar o próprio)', () => {
  async function comentarioDe(email: string, postId: number) {
    const { agent, userId } = await registerAndLogin(app, prisma, email, email);
    const res = await agent.post(`/posts/${postId}/comments`).set(asJson).send({ content: `de ${email}` });
    return { agent, userId, commentId: res.body.id as number };
  }

  it('apaga o próprio comentário e devolve 204', async () => {
    const { leitor, post } = await cenario();
    const meu = await comentarioDe('leitor2@exemplo.com', post.id);

    const res = await meu.agent.delete(`/comments/${meu.commentId}`).set(asJson);

    expect(res.status).toBe(204);
    expect(await prisma.comment.findUnique({ where: { id: meu.commentId } })).toBeNull();
  });

  it('não deixa apagar comentário de outra pessoa → 403 (e o comentário continua lá)', async () => {
    const { autor, post } = await cenario();
    const alheio = await comentarioDe('leitor3@exemplo.com', post.id);

    const res = await autor.agent.delete(`/comments/${alheio.commentId}`).set(asJson);

    expect(res.status).toBe(403);
    expect(await prisma.comment.findUnique({ where: { id: alheio.commentId } })).not.toBeNull();
  });

  it('sem sessão → 302 /login · inexistente → 404 · id malformado → 400', async () => {
    const { autor, post } = await cenario();
    const alvo = await comentarioDe('leitor4@exemplo.com', post.id);

    const semSessao = await request(app).delete(`/comments/${alvo.commentId}`).set(asJson);
    const inexistente = await autor.agent.delete('/comments/999999').set(asJson);
    const malformado = await autor.agent.delete('/comments/abc').set(asJson);

    expect(semSessao.status).toBe(302);
    expect(inexistente.status).toBe(404);
    expect(malformado.status).toBe(400);
  });
});

describe('POST /comments/:id/delete (fallback do formulário, sem JavaScript)', () => {
  it('apaga o próprio comentário e volta para a página anterior', async () => {
    const { leitor, post } = await cenario();
    const criado = await leitor.agent.post(`/posts/${post.id}/comments`).set(asJson).send({ content: 'via form' });

    const res = await leitor.agent
      .post(`/comments/${criado.body.id}/delete`)
      .set('Referer', `/posts/${post.id}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/posts/${post.id}`);
    expect(await prisma.comment.findUnique({ where: { id: criado.body.id } })).toBeNull();
  });

  it('não deixa apagar comentário de outra pessoa (403) e o comentário fica', async () => {
    const { autor, leitor, post } = await cenario();
    const criado = await leitor.agent.post(`/posts/${post.id}/comments`).set(asJson).send({ content: 'meu' });

    const res = await autor.agent.post(`/comments/${criado.body.id}/delete`).type('form');

    expect(res.status).toBe(403);
    expect(await prisma.comment.findUnique({ where: { id: criado.body.id } })).not.toBeNull();
  });
});

describe('feed — UI de comentários (E1b)', () => {
  /**
   * O feed mostra posts de quem o usuário SEGUE (o próprio post não aparece
   * no seu feed — comportamento herdado da Aula 05), então quem lê aqui é
   * sempre um seguidor do autor.
   */
  async function seguidorComPost() {
    const autor = await registerAndLogin(app, prisma, 'autor@exemplo.com', 'Autor');
    await autor.agent.post('/posts').type('form').send({ content: 'post do autor' });
    const post = await prisma.post.findFirstOrThrow({ where: { content: 'post do autor' } });

    const seguidor = await registerAndLogin(app, prisma, 'seguidor@exemplo.com', 'Seguidor');
    await seguidor.agent.post('/follow').type('form').send({ targetId: autor.userId });

    return { autor, seguidor, post };
  }

  it('renderiza o formulário de comentário em cada post do feed', async () => {
    const { seguidor } = await seguidorComPost();

    const res = await seguidor.agent.get('/');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/data-comment-form/);
    expect(res.text).toMatch(/action="\/posts\/\d+\/comments"/);
  });

  it('mostra os comentários do post com o autor', async () => {
    const { autor, seguidor, post } = await seguidorComPost();
    await autor.agent.post(`/posts/${post.id}/comments`).set(asJson).send({ content: 'comentário visível no feed' });

    const res = await seguidor.agent.get('/');

    expect(res.text).toContain('comentário visível no feed');
    expect(res.text).toContain('data-comment-list');
    expect(res.text).toContain('Autor'); // nome do autor do comentário
  });

  it('o botão de apagar aparece só no comentário do próprio usuário', async () => {
    const { autor, seguidor, post } = await seguidorComPost();
    await autor.agent.post(`/posts/${post.id}/comments`).set(asJson).send({ content: 'do autor' });
    await seguidor.agent.post(`/posts/${post.id}/comments`).set(asJson).send({ content: 'do seguidor' });

    const paraSeguidor = await seguidor.agent.get('/');

    // Dois comentários no post, mas o seguidor só pode apagar o dele.
    expect(paraSeguidor.text).toContain('do autor');
    expect(paraSeguidor.text).toContain('do seguidor');
    const deletes = (paraSeguidor.text.match(/data-comment-delete/g) ?? []).length;
    expect(deletes).toBe(1);
  });
});
