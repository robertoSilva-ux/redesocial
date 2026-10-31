# ADR-0009 — `PostImage` como tabela própria, migrando `Post.imageUrl` com passo de dados

- **Status:** Aceita
- **Data:** 2026-10-31
- **Decisores:** Roberto (autor do projeto) — decisão tomada seguindo o enunciado do Trabalho II
- **Substitui:** — · **Relaciona-se com:** ADR-0003 (migração com passo de dados), ADR-0007 (`ImageStorage`)

## Contexto

O item 4 do Trabalho II pede: *"migrar `Post.imageUrl` para `PostImage` (`id`, `url`, `order`,
`postId`) com relação 1:N · `upload.array('images', N)` no lugar de `upload.single('image')` · cada
arquivo passa pela mesma `ImageStorage`"*.

O que já existia era outro modelo de mídia, do Exercício 1 da Aula 04:

```prisma
model Image {
  id Int @id @default(autoincrement())
  url String @unique
  altText String?  mimeType String?  width Int?  height Int?
  ownerId Int      // dono = usuário
  postId  Int?     // vínculo opcional, onDelete: SetNull (a imagem sobrevive ao post)
}
```

E `Post.imageUrl String?`, uma coluna única. O seed preenche `imageUrl`, as views leem
`post.imageUrl`, e `/api/images` lista `Image`. O critério de avaliação exige que os posts do seed
**continuem com sua foto** depois da migração, e o ADR-0003 já fixou que mudança de formato com dado
existente entra como migration versionada com passo de dados.

Ou seja: havia duas saídas legítimas — criar a tabela que o enunciado nomeia, ou reaproveitar a que
já existia.

## Decisão

**Criar `PostImage`**, exatamente como o enunciado descreve, e migrar o dado existente:

```prisma
model PostImage {
  id     Int    @id @default(autoincrement())
  url    String
  order  Int    @default(0)
  postId Int
  post   Post   @relation(fields: [postId], references: [id], onDelete: Cascade)
  @@unique([postId, order])
}

model Post {
  // ... imageUrl String?  ← removida na mesma migration
  images PostImage[]
}
```

E o caminho de escrita passa a ser:

- `upload.array('images', 5)` em `POST /posts` (era `upload.single('image')`);
- **um `imageStorage.upload()` por arquivo**, na ordem em que chegaram, gravando `order` 0, 1, 2…;
- a porta `ImageStorage` (ADR-0007) não muda: continua `upload(file) → Promise<string>`.

A migration tem três passos, nesta ordem (ADR-0003):

1. `CREATE TABLE "PostImage"` + índice único (`postId`, `order`) + FK com `Cascade`;
2. `INSERT INTO "PostImage" (url, "order", "postId") SELECT "imageUrl", 0, id FROM "Post" WHERE "imageUrl" IS NOT NULL`;
3. remover a coluna `Post.imageUrl` (e, no SQLite, a reconstrução da tabela que o Prisma gera).

`Image` **fica como está**: continua sendo "arquivo do usuário" (avatar e uploads do Exercício 1,
com `altText`/`mimeType`/dimensões, listado em `/api/images`). O vínculo `Image.postId` passa a ser
considerado legado — a relação de foto-de-post é `PostImage`.

## Alternativas consideradas

- **Reaproveitar `Image`** (adicionar `order`, usar `Image` como foto do post). Uma tabela de mídia
  só, sem conceito novo. Mas `Image` é **do usuário** (`ownerId` obrigatório) e tem ciclo de vida
  desamarrado do post (`onDelete: SetNull`: apagar o post mantém a imagem órfã de propósito, para o
  Exercício 1). Foto de post é o oposto: pertence ao post e some com ele. Reaproveitar exigiria
  inverter o `onDelete`, remover `ownerId` como obrigatório e reescrever `/api/images` — ou seja,
  quebrar o Exercício 1 para caber no item 4.
- **Manter `Post.imageUrl` e criar `PostImage` em paralelo.** Duas fontes de verdade para a mesma
  foto (ADR-0003 já rejeita isso sem janela de convivência planejada).
- **`PostImage` sem o índice único (`postId`, `order`).** Duas fotos com a mesma ordem tornariam a
  ordenação não determinística na leitura; o índice custa nada e transforma uma convenção em
  invariante.

## Consequências

### Positivas

- A relação é 1:N de verdade, com ordem explícita e sem coluna especial no `Post`.
- Apagar o post apaga as fotos (`Cascade`) — o contrário do `Image`, e o certo para foto de post.
- `@@unique([postId, order])` impede ordem duplicada; a leitura sempre tem critério de desempate.
- A porta `ImageStorage` não mudou: `upload.array` entrega N buffers e o controller faz N chamadas.
- O critério "foto do seed preservada" passa a ser testável (teste que roda a migração e confere).

### Negativas / custos

- **Duas tabelas de mídia convivendo** (`Image` e `PostImage`), com nomes que convidam à confusão.
  É dívida de nomenclatura: quem chega depois precisa ler este ADR para saber qual é qual.
- `Image.postId` sobrevive como resquício do Exercício 1 — campo que já não representa "a foto do
  post". Poderia ser removido numa migration futura, com o mesmo cuidado de dados.
- **Mudança de contrato na leitura**: `Post.imageUrl` sai, `Post.images` entra. `/api/posts` e
  `/api/posts/:id` mudam de forma, e os testes/consumidores antigos precisam ser adaptados (foi o
  caso de `posts.routes.test.ts`, que afirmava `imageUrl`).
- A migration é irreversível no SQLite: não há `down`. Voltar exige outra migration.

### Riscos e mitigação

- **A reconstrução da tabela `Post` no SQLite pode afetar outras constraints.** É o risco registrado
  no ADR-0002 para o `CHECK` do `Like`: `test/integration/schema.test.ts` roda em toda suíte e
  falha se o `CHECK` desaparecer — por isso ele é a rede de segurança dessa migration.
- **Arquivo órfão quando o post não é criado.** Com N arquivos, o problema do cartão E0d multiplica
  (até 5 órfãos por tentativa). Fica registrado como pendência do E0d, não como resolvido aqui.
- **Perda de dado no passo 2.** Mitigação: o passo usa `WHERE "imageUrl" IS NOT NULL` e há teste que
  cria post com `imageUrl`, aplica a migração e verifica a foto em `PostImage` com `order = 0`.

## Referências

- Enunciado: `tads-webii-2026-2/TRABALHOS/TRABALHO II.md`, atividade 4 e Discussão obrigatória item 2
- `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts`
- `src/posts/PostController.ts`, `src/webRoutes.ts` (`upload.array`), `src/uploads/*`
- `test/integration/schema.test.ts` (rede de segurança do `CHECK`), `test/integration/posts.routes.test.ts`
- ADR-0003 (passo de dados), ADR-0007 (`ImageStorage`), cartão E0d (órfãos)
