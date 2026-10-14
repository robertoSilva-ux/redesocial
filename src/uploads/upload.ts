import multer from 'multer';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// `memoryStorage`: o Multer entrega o arquivo inteiro em `req.file.buffer`
// (RAM) em vez de gravá-lo em disco sozinho — é exatamente o formato que
// `ImageStorage#upload` espera, seja para mandar ao S3 (`PutObjectCommand`
// aceita um `Buffer`) ou para gravar localmente. Para arquivos grandes em
// produção, o ideal seria streaming em vez de carregar tudo na memória;
// para uma aula, com o limite de 5MB abaixo, é seguro.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      callback(new Error('Formato de imagem não suportado (use JPEG, PNG ou WebP)'));
      return;
    }
    callback(null, true);
  },
});
