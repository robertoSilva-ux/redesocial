import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { errorHandler } from '../../src/shared/errorHandler.js';
import { UserNotFoundError } from '../../src/shared/errors.js';
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

/**
 * O erro de JSON malformado nasce no `express.json()` — antes do controller.
 * É um SyntaxError com status 400 anexado; sem tratar, caía no 500 do default
 * e o cliente recebia "erro interno" por um corpo que era problema dele.
 */
describe('corpo da requisição inválido', () => {
  const jsonRequest = () =>
    request(app).post('/login').set('Content-Type', 'application/json').set('Accept', 'application/json');

  it('JSON malformado devolve 400, não 500', async () => {
    const res = await jsonRequest().send('{"email": "ana@exemplo.com"');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/json/i);
  });

  it('a mensagem do erro de parse é legível, não o texto cru do parser', async () => {
    const res = await jsonRequest().send('nao e json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JSON inválido no corpo da requisição');
  });

  it('com Accept: text/html o erro vira página (não JSON)', async () => {
    const res = await request(app)
      .post('/login')
      .set('Content-Type', 'application/json')
      .set('Accept', 'text/html')
      .send('nao e json');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('não grava nada quando o corpo é inválido', async () => {
    await jsonRequest().send('{"email": ');

    expect(await prisma.user.count()).toBe(0);
  });

  it('validação de domínio continua 400 (senha curta no registro)', async () => {
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({ name: 'Ana', email: 'ana@exemplo.com', password: '123' });

    expect(res.status).toBe(400);
  });
});

describe('errorHandler (unidade)', () => {
  function fakeResponse() {
    const res = { status: vi.fn(), json: vi.fn(), render: vi.fn() } as unknown as Response;
    (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
    return res;
  }

  // `req.accepts([...])` decide HTML x JSON; o dublê responde o que o teste quer.
  function fakeRequest(format: 'html' | 'json' = 'json') {
    return { accepts: () => format } as unknown as Request;
  }

  const next: NextFunction = () => {};

  it('erro desconhecido continua 500 (o default não foi engolido)', () => {
    const res = fakeResponse();

    errorHandler(new Error('boom'), fakeRequest(), res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'boom' });
  });

  it('status 4xx do body-parser é preservado (413 de corpo grande demais)', () => {
    const res = fakeResponse();
    const err = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });

    errorHandler(err, fakeRequest(), res, next);

    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('erro de domínio conhecido mantém o status do mapa', () => {
    const res = fakeResponse();

    errorHandler(new UserNotFoundError(7), fakeRequest(), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Usuário 7 não encontrado' });
  });

  it('erro de domínio com Accept html renderiza a view de erro', () => {
    const res = fakeResponse();

    errorHandler(new UserNotFoundError(7), fakeRequest('html'), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('error', {
      status: 404,
      message: 'Usuário 7 não encontrado',
    });
  });
});
