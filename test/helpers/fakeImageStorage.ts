import type { ImageStorage, UploadedFile } from '../../src/uploads/storage.js';

// Substitui S3ImageStorage/LocalImageStorage nos testes: nada de rede nem
// de disco, só registra o que recebeu e devolve uma URL previsível.
export class FakeImageStorage implements ImageStorage {
  public readonly uploads: UploadedFile[] = [];

  async upload(file: UploadedFile): Promise<string> {
    this.uploads.push(file);
    return `https://fake-bucket.test/${file.originalname}`;
  }
}
