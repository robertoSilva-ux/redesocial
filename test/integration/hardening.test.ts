import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

/**
 * Cartão E0b — hardening vindo da revisão de código (não do enunciado).
 *
 * Cada teste aqui existe porque um defeito foi encontrado **chamando a API**,
 * não lendo o código: hash de senha na resposta, 500 com stack do Prisma em id
 * malformado, HTML de erro em rota `/api` e página de post sem rota.
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

/** Cenário com um post, um comentário, um perfil, uma imagem e um like de outro usuário. */
async function cenario() {
  const autor = await registerAndLogin(app, prisma, 'autor@exemplo.com', 'Autor');
  await autor.agent.post('/posts').type('form').send({ content: 'post do autor', tags: 'prisma' });
  const post = await prisma.post.findFirstOrThrow({ where: { content: 'post do autor' } });

  await prisma.comment.create({
    data: { content: 'comentário do autor', authorId: autor.userId, postId: post.id },
  });
  await prisma.userProfile.create({ data: { userId: autor.userId, displayName: 'Autor' } });
  await prisma.image.create({
    data: { url: 'https://fake-bucket.test/foto.png', ownerId: autor.userId, postId: post.id },
  });

  const leitor = await registerAndLogin(app, prisma, 'leitor@exemplo.com', 'Leitor');
  await leitor.agent.post('/follow').type('form').send({ targetId: autor.userId });
  await leitor.agent.post(`/posts/${post.id}/like`).set(asJson);

  const row = await prisma.user.findUniqueOrThrow({ where: { email: 'autor@exemplo.com' } });
  return { autor, leitor, post, passwordHash: row.passwordHash };
}

describe('nenhuma resposta da API devolve passwordHash', () => {
  it('varre todos os endpoints de leitura e não encontra a coluna nem o hash', async () => {
    const { autor, post, passwordHash } = await cenario();

    const endpoints = [
      `/api/users/${autor.userId}`,
      `/api/users/${autor.userId}/feed`,
      `/api/posts/${post.id}`,
      '/api/posts',
      '/api/comments',
      '/api/likes',
      '/api/profiles',
      '/api/images',
      '/api/tags/prisma/posts',
    ];

    for (const url of endpoints) {
      const res = await request(app).get(url).set(asJson);
      const raw = JSON.stringify(res.body);

      expect(res.status, `${url} deveria responder 200`).toBe(200);
      expect(raw, `${url} expõe a coluna passwordHash`).not.toContain('passwordHash');
      expect(raw, `${url} expõe o hash real da senha`).not.toContain(passwordHash);
    }
  });

  it('a página do post também não carrega o hash (HTML)', async () => {
    const { autor, post, passwordHash } = await cenario();

    const res = await autor.agent.get(`/posts/${post.id}`);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(passwordHash);
  });
});

describe('id malformado é erro do cliente (400), não 500 do Prisma', () => {
  it('GET /api/posts/abc → 400 sem stack nem caminho do projeto', async () => {
    const res = await request(app).get('/api/posts/abc').set(asJson);

    expect(res.status).toBe(400);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('prisma');
    expect(raw).not.toContain('/home/');
    expect(raw).not.toContain('invocation');
  });

  it('GET /api/users/abc e /api/users/abc/feed → 400', async () => {
    expect((await request(app).get('/api/users/abc').set(asJson)).status).toBe(400);
    expect((await request(app).get('/api/users/abc/feed').set(asJson)).status).toBe(400);
  });

  it('POST /posts/abc/like e POST /posts/abc/delete → 400 (com sessão)', async () => {
    const { autor } = await cenario();

    const like = await autor.agent.post('/posts/abc/like').set(asJson);
    const del = await autor.agent.post('/posts/abc/delete').type('form');

    expect(like.status).toBe(400);
    expect(del.status).toBe(400);
  });
});

describe('erro em rota /api responde JSON mesmo sem Accept explícito', () => {
  it('cliente no estilo curl (Accept: */*) recebe JSON, não página HTML', async () => {
    const res = await request(app).get('/api/users/999999').set('Accept', '*/*');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toMatch(/não encontrado/i);
  });

  it('navegador (Accept: text/html) em rota HTML continua recebendo página', async () => {
    const res = await request(app).get('/posts/999999').set('Accept', 'text/html');

    // Sem sessão: requireAuth redireciona antes de chegar ao 404 do post.
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

describe('GET /posts/:id — página do post', () => {
  it('abre o post com autor, conteúdo e comentários', async () => {
    const { leitor, post } = await cenario();

    const res = await leitor.agent.get(`/posts/${post.id}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('post do autor');
    expect(res.text).toContain('Autor');
    expect(res.text).toContain('comentário do autor');
  });

  it('post inexistente → 404', async () => {
    const { leitor } = await cenario();

    const res = await leitor.agent.get('/posts/999999');

    expect(res.status).toBe(404);
  });

  it('sem sessão redireciona para /login', async () => {
    const { post } = await cenario();

    const res = await request(app).get(`/posts/${post.id}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('/posts/new continua abrindo o formulário (não é capturado por :id)', async () => {
    const { autor } = await cenario();

    const res = await autor.agent.get('/posts/new');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Novo post');
  });
});
