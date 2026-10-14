export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

// Porta pequena e local (não é o "ports & adapters" da Aula 05 original do
// plano — só uma interface para trocar S3 por disco local em dev/teste sem
// mexer em quem chama `upload`). Devolve sempre uma URL: o binário da
// imagem nunca entra no banco de dados, só o endereço onde ela mora.
export interface ImageStorage {
  upload(file: UploadedFile): Promise<string>;
}
