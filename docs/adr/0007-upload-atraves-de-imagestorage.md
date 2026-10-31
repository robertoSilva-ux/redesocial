# ADR-0007 — Upload atrás da porta `ImageStorage` (arquivo local × S3 pelo `.env`)

- **Status:** Aceita
- **Data:** 2026-10-14
- **Decisores:** Roberto (autor do projeto); desenho herdado do material da Aula 05

## Contexto

O projeto recebe imagem em dois lugares: avatar no registro e imagem do post. Duas implementações possíveis coexistiam — gravar no bucket S3 (produção) e gravar em disco (aula, sem credenciais da AWS). Quem chama o upload (Controller e rotas) não pode escolher entre as duas: isso é infraestrutura, não regra de negócio. E o critério do trabalho diz que o binário nunca deve ir para o banco.

O Trabalho II (item 4) vai trocar uma foto por **várias** e usar `upload.array('images', N)` — o que só é barato se a costura de upload já estiver isolada.

## Decisão

Uma porta minúscula, `ImageStorage`, e duas implementações:

```ts
export interface ImageStorage {
  upload(file: UploadedFile): Promise<string>; // devolve a URL pública
}
```

- `createImageStorage()` (`src/uploads/createImageStorage.ts`) escolhe a implementação pela presença de `AWS_S3_BUCKET` **e** `AWS_REGION`: com as duas, `S3ImageStorage`; sem elas, `LocalImageStorage` (grava em `uploads/` e devolve `/uploads/<uuid>`);
- a escolha acontece uma vez, no composition root (`server.ts` → `index.ts`), e o `ImageStorage` resultante é injetado nas rotas — nenhum Controller decide isso;
- o binário nunca é gravado no banco: `Post.imageUrl`/`Image.url` guardam **endereço**, não bytes;
- o recebimento dos arquivos fica no Multer com `memoryStorage`, limite de 5 MB e lista branca de MIME (`image/jpeg`, `image/png`, `image/webp`) — o buffer em memória é exatamente o que a porta precisa para mandar ao S3 ou gravar em disco;
- nos testes, `FakeImageStorage` implementa a mesma porta e devolve uma URL previsível — é o único dublê do projeto, e existe porque a porta existe.

## Alternativas consideradas

- **Chamar `fs.writeFile`/`S3Client` direto no Controller.** Menos um arquivo, mas o Controller passa a depender de AWS e do sistema de arquivos, e cada teste de upload exigiria um bucket ou um diretório temporário.
- **Salvar a imagem como BLOB no SQLite.** Um banco só, backup único; em troca, o banco cresce com binário, toda leitura de post carrega o blob e não há CDN. Ruim para imagem de feed.
- **Escolher por `NODE_ENV` em vez de por configuração presente.** Um ambiente de produção sem bucket cairia silenciosamente no disco local; aqui a ausência de configuração já cai no disco, mas é explícito no `.env.example` e logado pela escolha em `createImageStorage()`.

## Consequências

### Positivas

- Trocar de disco para S3 é configuração (`AWS_S3_BUCKET`, `AWS_REGION`), sem tocar em código de aplicação.
- O `uploads/` local é servido por `express.static` em `/uploads`, então a view de dev tem URL absoluta igual à do S3.
- O item 4 do Trabalho II não muda a costura: `upload.array` entrega vários buffers, e cada um passa pela **mesma** `upload()` (uma chamada por arquivo).

### Negativas / custos

- `S3ImageStorage` **não é exercitado pela suíte**: só `FakeImageStorage` e `LocalImageStorage` rodam nos testes. O caminho de S3 é verificado manualmente, com bucket real.
- `memoryStorage` carrega o arquivo inteiro na RAM; com 5 MB e uma turma, é seguro, mas upload
  grande em produção pediria streaming.
- Um `ImageStorage` que devolvesse a URL errada (relativa × absoluta) passaria nos testes e
  quebraria na view — o contrato é só "string", sem tipo que distinga os casos.
- A porta não cobre **remoção**: apagar um post apaga a linha `Image` (banco), mas o arquivo no S3
  ou em `uploads/` fica órfão. É dívida conhecida, não bug do trabalho.

### Riscos e mitigação

- **Mock diferente do real.** `FakeImageStorage` devolvendo URL fixa esconde erro de caminho.
  Mitigação: `test/unit/localStorage.test.ts` exercita o adaptador local de verdade (UUID, extensão,
  diretório), que é o que roda em aula.
- **Arquivo órfão acumulando.** Mitigação futura: rotina de limpeza que compara `uploads/` com as
  URLs referenciadas no banco. Registrado aqui para não virar surpresa.

## Referências

- `src/uploads/storage.ts`, `createImageStorage.ts`, `localStorage.ts`, `s3Storage.ts`, `upload.ts`
- `src/server.ts` (injeção), `test/helpers/fakeImageStorage.ts`, `test/unit/localStorage.test.ts`
- `.env.example` (variáveis de S3)
