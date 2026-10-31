# ADR-0002 — Uma tabela `Like`, com alvo exclusivo (post **ou** comentário)

- **Status:** Aceita
- **Data:** 2026-10-13
- **Decisores:** Roberto (autor do projeto)

## Contexto

O projeto precisa de dois tipos de curtida: em post (Aula 05, Exercício 1) e em comentário (Trabalho II, item 3). O enunciado do Trabalho II nomeia **duas** tabelas — `Like (userId, postId,
@@id([userId, postId]))` e `CommentLike (userId, commentId, @@id([userId, commentId]))`.

O que já existia: `Like` com `id` surrogate, `userId` obrigatório, `postId` e `commentId` ambos opcionais, dois `@@unique` (`[userId, postId]` e `[userId, commentId]`), e um `CHECK` escrito à mão na migration. A decisão foi tomada no Exercício 1 da Aula 04, antes de haver curtida em comentário no escopo — e o comentário já nasceu como entidade de primeira classe (com autorrelação 1:N para respostas), o que sinalizava que ele seria alvo de curtida.

## Decisão

Manter **uma** tabela `Like`, polimórfica por alvo exclusivo:

```prisma
model Like {
  id     Int @id @default(autoincrement())
  userId Int
  postId    Int?
  commentId Int?
  @@unique([userId, postId])
  @@unique([userId, commentId])
}
```

A invariante "exatamente um alvo" não é expressável no schema do Prisma, então vive como `CONSTRAINT "Like_one_target" CHECK (("postId" IS NOT NULL) + ("commentId" IS NOT NULL) = 1)` dentro da migration `20261014013133_add_comment_like_userprofile_image`.

Um único `LikeController` responde pelos dois alvos (`togglePostLike` hoje; `toggleCommentLike` quando o item 3 for implementado), e as rotas ficam explícitas no caminho (`/posts/:id/like`, `/comments/:id/like`) — quem distingue o alvo é a rota, não o corpo da requisição.

## Alternativas consideradas

- **`Like` + `CommentLike` separadas (como no enunciado).** São duas tabelas quase idênticas, dois pares de `@@unique`, dois caminhos de contagem, e nada impede que a regra de uma divirja da outra depois. O ganho é legibilidade e aderência literal ao texto do trabalho.
- **`@@id([userId, postId])` composta, como o enunciado sugere.** Não serve: com `postId` obrigatório, curtir comentário exigiria uma segunda tabela (é a alternativa acima).
- **Tabela de alvo genérica (`targetType` + `targetId`).** Sem FK — SQLite não valida que o id existe no alvo — e as consultas por post passam a exigir filtro duplo. Ganha-se extensibilidade para alvos futuros, perde-se integridade referencial, que é o que o `onDelete: Cascade` garante.

## Consequências

### Positivas

- Zero migração para o item 3 do Trabalho II: a tabela já aceita `commentId`.
- Uma contagem só (`like.count({ where: { postId } })` / `{ commentId }`) e um Controller para os dois alvos.
- Apagar post ou comentário apaga as curtidas por `Cascade`, de graça.

### Negativas / custos

- **Divergência nominal do enunciado**: não existe tabela `CommentLike`. Isso precisa estar escrito (este ADR) e justificado na entrega.
- A invariante principal **não aparece no `schema.prisma`** — quem lê só o schema não vê o XOR.
  Quem lê a migration vê.
- `postId`/`commentId` anuláveis obrigam toda consulta de curtida a filtrar por um dos lados; uma consulta sem filtro (o `GET /api/likes` do Exercício 1) mistura os dois tipos.

### Riscos e mitigação

- **A regra do `CHECK` se perder numa migração futura.** SQLite não tem `ALTER TABLE` completo:
  mudanças de coluna reconstroem a tabela, e uma reconstrução gerada pelo Prisma **não recria o
  `CHECK`** (ele não está no schema). Mitigação: `test/integration/schema.test.ts` cobre
  "rejeita like sem alvo e like com dois alvos" — se a constraint desaparecer, o teste fica
  vermelho. Toda migração que toque `Like` precisa reconferir esse teste.
- **`P2002` em corrida de duplo clique.** Mitigado no `LikeController`, que engole o erro de
  unicidade porque o estado desejado já vale.

## Referências

- `prisma/schema.prisma` (model `Like`), `prisma/migrations/20261014013133_.../migration.sql`
- `test/integration/schema.test.ts` ("Like (alvo exclusivo: post OU comentário)")
- `src/likes/LikeController.ts`
- Pendência registrada em `docs/README.md`: separar em duas tabelas substituiria este ADR.
