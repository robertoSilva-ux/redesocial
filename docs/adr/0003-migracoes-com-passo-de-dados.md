# ADR-0003 — Migração sempre versionada, com passo de dados quando há dado existente

- **Status:** Aceita
- **Data:** 2026-10-27
- **Decisores:** Roberto (autor do projeto)
- **Vale também para:** item 4 do Trabalho II (múltiplas fotos por post), ainda não implementado

## Contexto

O item 4 do Trabalho II exige trocar `Post.imageUrl` (uma coluna `String?`) por uma relação
`Post → PostImage[]`. Isso é uma **mudança de formato com dados existentes**: o seed e o banco de
desenvolvimento já têm posts com `imageUrl` preenchido, e a view e os testes leem esse campo.

O critério de avaliação é explícito: "os posts do seed que já tinham `imageUrl` devem continuar com
sua foto após a migração". Há duas saídas possíveis: escrever a migração com passo de dados, ou
recomeçar o banco com `prisma migrate reset`.

## Decisão

Toda mudança de schema entra como **migration versionada** (`prisma migrate dev` gerando o SQL),
commitada junto do código que a usa. Quando a mudança envolve dado existente, a migration tem três
passos na ordem:

1. criar a estrutura nova (`CREATE TABLE "PostImage"` + índices + FK);
2. copiar o dado (`INSERT INTO "PostImage" (url, "postId", "order") SELECT imageUrl, id, 0 FROM "Post" WHERE imageUrl IS NOT NULL`);
3. só então remover a coluna antiga (ou mantê-la temporariamente, se houver janela de convivência).

`prisma migrate reset` é permitido **apenas** em banco de desenvolvimento/teste descartável (é o
que o `test/globalSetup.ts` faz ao apagar `test.db` e rodar `migrate deploy`). Em produção, o único
comando é `prisma migrate deploy` — incremental e não destrutivo.

## Alternativas consideradas

- **`prisma migrate reset` e semear de novo.** Duas linhas, banco limpo, zero SQL manual. Custa os
  dados e, num banco com informação que não se reproduz (upload de usuário, post real), custa o que
  não tem backup. Inaceitável fora de desenvolvimento.
- **Manter `imageUrl` e criar `PostImage` em paralelo, sem remover a coluna.** Evita o passo 3,
  mas cria **duas fontes de verdade** para a mesma foto: uma view lê `imageUrl`, outra lê
  `images[]`, e um dia divergem. Só se justifica com uma janela de convivência planejada e um
  critério de saída escrito.
- **Migração fora do Prisma (script de seed).** Corrige o dado, mas não o schema; não versiona a
  mudança e não roda no deploy.

## Consequências

### Positivas

- A mudança é auditável: o SQL está no repositório, na ordem em que rodou.
- `migrate deploy` aplica o mesmo SQL em qualquer ambiente (dev, teste, CI) sem intervenção.
- O critério "migração sem perda de dados" passa a ser **testável** — dá para escrever um teste que
  cria um post com `imageUrl` no banco antigo e verifica que, após a migração, existe a foto.

### Negativas / custos

- SQL escrito à mão: o Prisma gera o `CREATE TABLE`, mas não o `INSERT ... SELECT` — o passo de
  dados é responsabilidade de quem escreve a migration.
- SQLite não tem migração reversível: não há `down`. Reverter significa escrever outra migration.
- Reconstruções de tabela (quando o SQLite exige copiar a tabela para mudar uma coluna) **recriam
  a tabela e podem perder constraints escritas à mão** — é o caso do `CHECK` do `Like`
  (ADR-0002).

### Riscos e mitigação

- **Passo de dados com erro de mapeamento** (ex.: `order` começando em 1 em vez de 0, ou foto do
  seed indo para o `ownerId` errado). Mitigação: a migration é exercitada no `test.db` a cada
  `npm test` (globalSetup roda `migrate deploy` do zero), e o teste do critério acima roda no mesmo
  caminho.
- **Migração irreversível descoberta tarde.** Mitigação: backup do `dev.db` antes de aplicar
  migration destrutiva em banco com dados de demonstração.

## Referências

- `prisma/migrations/`, `prisma/schema.prisma`
- `test/globalSetup.ts` (`migrate deploy` no banco de teste)
- `README.md` → "Discussão obrigatória — Trabalho II", item 2
