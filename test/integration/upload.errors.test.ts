import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { MAX_IMAGE_BYTES } from '../../src/uploads/upload.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

/**
 * Cartão E0c — upload recusado respondia 500.
 *
 * O multer 2 não anexa `status` ao `MulterError`, só `code`; o error handler
 * não conhecia esses códigos e jogava tudo no 500 genérico. Estes testes fixam
 * o status de cada recusa e provam que a mensagem não vaza detalhe interno.
 */

const prisma: PrismaClient = createTestPrismaClient();
const storage = new FakeImageStorage();
const app = createServer(prisma, storage);

beforeEach(async () => {
  await resetDatabase(prisma);
  storage.uploads.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function autenticado() {
  return registerAndLogin(app, prisma, 'autora@exemplo.com', 'Autora');
}

function semDetalheInterno(texto: string) {
  expect(texto).not.toContain('busboy');
  expect(texto).not.toContain('/home/');
  expect(texto).not.toContain('at make-middleware');
  expect(texto).not.toContain('MulterError');
}

describe('POST /posts com upload recusado', () => {
  it('arquivo acima do limite → 413 com o limite na mensagem', async () => {
    const { agent } = await autenticado();
    const grande = Buffer.alloc(MAX_IMAGE_BYTES + 1024, 0x41);

    const res = await agent
      .post('/posts')
      .field('content', 'post com arquivo grande')
      .attach('images', grande, { filename: 'grande.png', contentType: 'image/png' });

    expect(res.status).toBe(413);
    expect(res.text).toMatch(/5 MB/);
    semDetalheInterno(res.text);
    expect(await prisma.post.count()).toBe(0);
    expect(storage.uploads).toHaveLength(0);
  });

  it('campo de arquivo inesperado → 400 (a rota aceita só "images")', async () => {
    const { agent } = await autenticado();

    const res = await agent
      .post('/posts')
      .field('content', 'post com campo errado')
      .attach('image', PNG, { filename: 'foto.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/campo de arquivo/i);
    semDetalheInterno(res.text);
    expect(await prisma.post.count()).toBe(0);
  });

  it('MIME não permitido → 400 com mensagem legível (não 500)', async () => {
    const { agent } = await autenticado();

    const res = await agent
      .post('/posts')
      .field('content', 'post com txt')
      .attach('images', Buffer.from('não sou imagem'), { filename: 'nota.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Formato de imagem não suportado/);
    semDetalheInterno(res.text);
    expect(storage.uploads).toHaveLength(0);
  });

  it('upload válido continua funcionando (302 e uma chamada ao storage)', async () => {
    const { agent } = await autenticado();

    const res = await agent
      .post('/posts')
      .field('content', 'post com foto de verdade')
      .attach('images', PNG, { filename: 'foto.png', contentType: 'image/png' });

    expect(res.status).toBe(302);
    expect(storage.uploads).toHaveLength(1);
    const post = await prisma.post.findFirstOrThrow({
      where: { content: 'post com foto de verdade' },
      include: { images: true },
    });
    expect(post.images).toHaveLength(1);
    expect(post.images[0].url).toBe('https://fake-bucket.test/foto.png');
  });

  it('a mesma recusa em rota /api responde JSON, não página', async () => {
    const { agent } = await autenticado();
    const grande = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x41);

    const res = await agent
      .post('/posts')
      .set('Accept', 'application/json')
      .field('content', 'post grande')
      .attach('images', grande, { filename: 'grande.png', contentType: 'image/png' });

    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toMatch(/5 MB/);
  });
});
