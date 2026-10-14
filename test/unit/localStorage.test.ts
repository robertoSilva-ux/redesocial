import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalImageStorage, UPLOAD_DIR } from '../../src/uploads/localStorage.js';

describe('LocalImageStorage', () => {
  const storage = new LocalImageStorage();
  let writtenUrl: string | undefined;

  afterEach(async () => {
    if (writtenUrl) {
      await rm(path.join(UPLOAD_DIR, path.basename(writtenUrl)), { force: true });
      writtenUrl = undefined;
    }
  });

  it('grava o arquivo em uploads/ e devolve uma URL local servível por express.static', async () => {
    writtenUrl = await storage.upload({
      buffer: Buffer.from('conteudo-fake'),
      mimetype: 'image/png',
      originalname: 'foto.png',
    });

    expect(writtenUrl).toMatch(/^\/uploads\/.+\.png$/);

    const savedContent = await readFile(path.join(UPLOAD_DIR, path.basename(writtenUrl)));
    expect(savedContent.toString()).toBe('conteudo-fake');
  });
});
