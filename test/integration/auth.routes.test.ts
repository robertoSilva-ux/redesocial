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

describe('autenticação/autorização — acesso sem sessão', () => {
  it('GET / redireciona para /login (requireAuth)', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('GET /posts/new redireciona para /login', async () => {
    const res = await request(app).get('/posts/new');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

describe('POST /register', () => {
  it('cria o usuário com senha em hash (nunca em texto puro) e já loga', async () => {
    const agent = request.agent(app);

    const res = await agent.post('/register').type('form').send({
      name: 'Ana',
      email: 'ana@exemplo.com',
      password: 'senha123',
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@exemplo.com' } });
    expect(user.passwordHash).not.toBe('senha123');

    // A sessão criada no registro já dá acesso à área logada.
    const feed = await agent.get('/');
    expect(feed.status).toBe(200);
    expect(feed.text).toContain('Ana');
  });

  it('rejeita senha curta', async () => {
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({ name: 'Ana', email: 'ana@exemplo.com', password: '123' });

    expect(res.status).toBe(400);
  });

  it('rejeita e-mail duplicado', async () => {
    await request(app)
      .post('/register')
      .type('form')
      .send({ name: 'Ana', email: 'ana@exemplo.com', password: 'senha123' });

    const res = await request(app)
      .post('/register')
      .type('form')
      .send({ name: 'Outra Ana', email: 'ana@exemplo.com', password: 'senha123' });

    expect(res.status).toBe(409);
  });
});

describe('POST /login e POST /logout', () => {
  async function registerUser(email: string) {
    await request(app).post('/register').type('form').send({ name: 'Ana', email, password: 'senha123' });
  }

  it('loga com credenciais corretas', async () => {
    await registerUser('ana@exemplo.com');
    const agent = request.agent(app);

    const res = await agent.post('/login').type('form').send({ email: 'ana@exemplo.com', password: 'senha123' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const feed = await agent.get('/');
    expect(feed.status).toBe(200);
  });

  it('rejeita senha errada com a MESMA mensagem de e-mail inexistente (evita user enumeration)', async () => {
    await registerUser('ana@exemplo.com');

    const wrongPassword = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'ana@exemplo.com', password: 'errada' });
    const unknownEmail = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'ninguem@exemplo.com', password: 'senha123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.text).toContain('E-mail ou senha inválidos');
    expect(unknownEmail.text).toContain('E-mail ou senha inválidos');
  });

  it('logout encerra a sessão — área logada volta a exigir login', async () => {
    await registerUser('ana@exemplo.com');
    const agent = request.agent(app);
    await agent.post('/login').type('form').send({ email: 'ana@exemplo.com', password: 'senha123' });

    await agent.post('/logout');
    const res = await agent.get('/');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
