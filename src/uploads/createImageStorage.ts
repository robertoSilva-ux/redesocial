import type { ImageStorage } from './storage.js';
import { S3ImageStorage } from './s3Storage.js';
import { LocalImageStorage } from './localStorage.js';

// Escolhe a implementação pela presença de configuração da AWS. Em aula,
// sem `AWS_S3_BUCKET`/`AWS_REGION` definidos, cai automaticamente no
// storage local — quem tiver um bucket real configurado (ver
// rede-social/README.md) testa a integração com S3 de verdade, sem trocar
// uma linha de código do resto da aplicação.
export function createImageStorage(): ImageStorage {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;

  if (bucket && region) {
    return new S3ImageStorage(bucket, region);
  }

  return new LocalImageStorage();
}
