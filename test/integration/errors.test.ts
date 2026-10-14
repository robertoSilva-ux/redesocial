import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { errorHandler } from '../../src/shared/errorHandler.js';
import { UserNotFoundError } from '../../src/shared/errors.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';

const prisma: PrismaClient = createTestPrismaClient();
const app = createServer(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * O erro de JSON malformado nasce no `express.json()`, antes do controller:
 * é um SyntaxError com status 400 que o errorHandler não conhecia, então caía
 * no 500 do default — o cliente recebia "erro interno" por um problema dele.
 */
describe('corpo da requisição inválido', () => {
  it('JSON malformado devolve 400, não 500', async () => {
    const res = await request(app)
      .post('/users')
      .set('Content-Type', 'application/json')
      .send('{"name": "Ana"');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/json/i);
  });

  it('não grava nada quando o corpo é inválido', async () => {
    await request(app)
      .post('/users')
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(await prisma.user.count()).toBe(0);
  });

  it('JSON válido continua caindo na validação de domínio (400 do ValidationError)', async () => {
    const res = await request(app).post('/users').send({ email: 'sem-nome@exemplo.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it('a mensagem do erro de parse é legível, não o texto cru do parser', async () => {
    const res = await request(app)
      .post('/posts')
      .set('Content-Type', 'application/json')
      .send('nao e json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JSON inválido no corpo da requisição');
  });
});

describe('errorHandler (unidade)', () => {
  function fakeResponse() {
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
    return res;
  }

  it('erro desconhecido continua 500 (o default não foi engolido)', () => {
    const res = fakeResponse();

    errorHandler(new Error('boom'), {} as Request, res, (() => {}) as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'boom' });
  });

  it('erro 5xx do body-parser não vira 400', () => {
    const res = fakeResponse();
    const err = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });

    errorHandler(err, {} as Request, res, (() => {}) as NextFunction);

    // 413 é 4xx: o status do próprio erro é preservado
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('erro de domínio conhecido mantém o status do mapa', () => {
    const res = fakeResponse();

    errorHandler(new UserNotFoundError(7), {} as Request, res, (() => {}) as NextFunction);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Usuário 7 não encontrado' });
  });
});
