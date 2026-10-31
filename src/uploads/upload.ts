import multer from 'multer';
import { ValidationError } from '../shared/errors.js';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Limite em bytes, exportado para o error handler poder dizer o limite na
// mensagem (e para não existirem dois números divergentes no projeto).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Quantas fotos um post aceita em uma requisição (item 4 do Trabalho II).
// O multer recusa o excedente com `LIMIT_FILE_COUNT` → 400 no error handler.
export const MAX_POST_IMAGES = 5;

// `memoryStorage`: o Multer entrega o arquivo inteiro em `req.file.buffer`
// (RAM) em vez de gravá-lo em disco sozinho — é exatamente o formato que
// `ImageStorage#upload` espera, seja para mandar ao S3 (`PutObjectCommand`
// aceita um `Buffer`) ou para gravar localmente. Para arquivos grandes em
// produção, o ideal seria streaming em vez de carregar tudo na memória;
// para uma aula, com o limite de 5MB abaixo, é seguro.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      // `ValidationError` (e não `Error`) de propósito: é erro do cliente, e o
      // error handler mapeia essa classe para 400. Com `Error` cru, um upload
      // com MIME errado virava 500 "erro interno" (achado do cartão E0c).
      callback(new ValidationError('Formato de imagem não suportado (use JPEG, PNG ou WebP)'));
      return;
    }
    callback(null, true);
  },
});
