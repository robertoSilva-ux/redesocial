import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageStorage, UploadedFile } from './storage.js';

export const UPLOAD_DIR = path.resolve(import.meta.dirname, '..', '..', 'uploads');

// Substituto de `S3ImageStorage` para rodar em aula/dev sem credenciais da
// AWS: grava o arquivo em disco, em `uploads/`, e devolve uma URL servida
// pelo próprio Express (`express.static`, configurado em server.ts). O
// resto da aplicação (PostController, views) não sabe nem precisa saber
// qual das duas implementações está em uso — só chama `upload()`.
export class LocalImageStorage implements ImageStorage {
  async upload(file: UploadedFile): Promise<string> {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const extension = file.originalname.split('.').pop();
    const filename = `${randomUUID()}${extension ? `.${extension}` : ''}`;

    await writeFile(path.join(UPLOAD_DIR, filename), file.buffer);

    return `/uploads/${filename}`;
  }
}
