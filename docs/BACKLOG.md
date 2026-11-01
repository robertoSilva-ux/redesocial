# Backlog — Trabalho II

Fonte do escopo: `tads-webii-2026-2/TRABALHOS/TRABALHO II.md` (10 atividades; 1→6 encadeadas).
Este arquivo é a **especificação** do trabalho; o fluxo (quem faz, o que está em andamento, o que
travou) vive no quadro Kanban do Hermes, board **`webii`**.

Regra do backlog: todo cartão termina com `npm test` verde e, quando muda arquitetura, com
`docs/arquitetura/c4.md` atualizado no mesmo commit. Baseline antes deste trabalho: **74 testes**,
item 1 já entregue.

## Resumo

| Inc. | Cartões | Escopo | Enunciado | Depende de |
| --- | --- | --- | --- | --- |
| E0 | 1 | conserto durável da dependência nativa (`better-sqlite3`) | — | — |
| E0b | 1 | ✅ hardening: `select` explícito, 500 sem vazar interno, validação de `:id`, `GET /posts/:id` | pré-requisito de E1 | E0 |
| E1 | 3 | comentários em post: escrita ✅, autorização ✅, UI via `fetch` ✅ | atividade 2 | E0b |
| E2 | 3 | curtida em comentário ✅ + otimista/rollback nos comentários ✅ | atividades 3 e 8 | E1a |
| E3 | 3 | múltiplas fotos: decisão ✅, migração com dados ✅, `upload.array` ✅ | atividade 4 | E2c |
| E4 | 1 | carrossel no feed ✅ | atividade 5 | E3c |
| E5 | 3 | feed por cursor ✅ + scroll infinito ✅ (fragmento HTML) | atividade 6 | E4 |
| E6 | 3 | editar comentário, ordenar por curtidas, contador de novidades | atividades 7, 9, 10 | E2b |
| E7 | 3 | fechamento: README, cobertura, revisão e roteiro da gravação | critérios de avaliação | E5c + E6 |

## E0 — ambiente — ✅ concluído em 31/10

**Problema.** `npm install` reinstalava `better-sqlite3@12.11.1` aninhado em
`@prisma/adapter-better-sqlite3`, com binário incompatível com Node 24 (ABI 137): 69 de 74 testes
caíam com `Module did not self-register`.

**Solução (ADR-0008).** Override global `"better-sqlite3": "^13.0.3"` em `package.json` + lock
regenerado com `npm install --package-lock-only`. A cópia aninhada sumiu (o lock perdeu 361 linhas,
todas dela), o adapter resolve `13.0.3` (`deduped`) e a 13.0.3 traz `prebuilds/` no tarball — instala
sem precisar aprovar script de build.

**Aceite cumprido.** `npm ci` de árvore limpa → `npm test` **74/74**, verificado primeiro numa cópia
isolada e depois no repositório; `npm ls better-sqlite3` = uma cópia, sem `invalid`;
`npm install --dry-run` não propõe nenhum `add`.

### Atualização de dependências (31/10)

`npm audit fix` (sem `--force`, só dentro dos ranges declarados): **14 → 5**. Em produção, 10 → 2
(sobrava `qs`/DoS). Fechado com `npm update express` (4.22.2 → **4.22.3**, que puxa `qs ~6.16.0` em
vez de `~6.15.1`): **0 vulnerabilidades em produção**. Restam 3 moderadas de **dev**
(`vitest`, `@vitest/mocker`, `@vitest/coverage-v8` — injeção de código em mock manual; exige major do
Vitest, fora do escopo).

Diretas que mudaram: `multer 2.2.0 → 2.5.0` e `prisma 7.10.0 → 7.10.1`; 53 entradas no lock.
Verificado depois: **100 testes**, `tsc` limpo, override do `better-sqlite3` intacto, e smoke no
servidor real (login, feed, `/api/posts`, comentário por formulário e upload multipart com gravação
em `uploads/`).

O smoke revelou um defeito que a suíte não cobria: `MulterError` caía em **500**. Enviar um campo de
arquivo inesperado (`images` quando a rota espera `image`) ou um arquivo acima de 5 MB devolvia
"Erro interno do servidor" em vez de 400/413 — fechado no cartão **E0c**.

## E0c — upload recusado respondia 500 — ✅ concluído em 31/10

| Caso | Antes | Agora |
| --- | --- | --- |
| arquivo acima de 5 MB | 500 | **413** "Arquivo maior que o limite de 5 MB" |
| campo de arquivo inesperado | 500 | **400** "Campo de arquivo não aceito por esta rota" |
| MIME não permitido | 500 | **400** "Formato de imagem não suportado" |
| upload válido | 302 | 302 (sem regressão) |

Causa: o `MulterError` do multer 2 traz `code` e **não** traz `status`, então não entrava nem no mapa
de erros de domínio nem no do body-parser. O `errorHandler` ganhou um mapa `code → status` + mensagem
(`MAX_IMAGE_BYTES` exportado do `upload.ts`, para o número não existir em dois lugares), e o
`fileFilter` passou a recusar MIME com `ValidationError` em vez de `Error` cru. 5 testes novos em
`test/integration/upload.errors.test.ts` (105 no total); um teste antigo de `posts.routes.test.ts`
afirmava o 500 e foi corrigido.

**Dívida que o E0c não resolveu:** upload **válido** com post inválido (`content` vazio) devolve 400 e
**deixa o arquivo gravado** em `uploads/` — confirmado no smoke. Consertar exige `remove()` na porta
`ImageStorage` (que hoje só tem `upload`), isso é mudança de decisão (ADR-0007) e virou o cartão **E0d**.

## E0b — hardening — ✅ concluído em 31/10

Veio da revisão de código, não do enunciado: defeitos que o avaliador encontra e que o E1 herdaria.
Resultado: `passwordHash` fora de todas as respostas, 500 sem detalhe interno, `:id` validado em toda
rota e `GET /posts/:id` funcionando — **86 testes** (74 + 12 novos em `test/integration/hardening.test.ts`).

| Achado | Evidência | Correção |
| --- | --- | --- |
| `passwordHash` (e `email`) na API | `GET /api/users/10` e `/api/posts/10` devolvem o hash; `include: { author: true }` | `select` explícito em todo include |
| 500 com stack do Prisma e caminho do projeto | `GET /api/posts/abc` → 500 com `invocation in /home/…PostController.ts:50` | validar `:id`; 500 com mensagem genérica + log no servidor |
| Erro de `/api/*` em HTML | cliente com `Accept: */*` recebe página de erro | decidir por path, não só por `Accept` |
| `GET /posts/:id` inexistente | feed linka `/posts/<id>`; `post.ejs` sem rota | registrar a rota com `requireAuth` |

**Aceite.** Teste que falha se `passwordHash` aparecer em qualquer resposta `/api/*`; nenhuma resposta
contendo `prisma`/caminho de arquivo; `curl` sem header em `/api/*` devolve JSON; página do post
abre com 200. Ajustar `test/integration/errors.test.ts:86-92`, que hoje afirma o vazamento.

**Fora deste cartão** (registrados para decisão posterior): sessão (`sameSite`/`secure`/`regenerate`
no login, fallback do `SESSION_SECRET`), CSRF nos POSTs, validação real de upload (magic bytes +
extensão derivada do tipo), arquivo órfão quando a validação falha, `MulterError` caindo em 500,
`listByTag` sem paginação (o README diz que é paginada) e o `console.log` em `webRoutes.ts:109`.

## E1 — comentários (atividade 2) — ✅ concluído em 31/10

**Escopo.** `create`/`listByPost`/`remove` no `comments/`, `requireOwnComment`, rotas
`POST`/`GET /posts/:id/comments` e `DELETE /comments/:id`, form no feed via `fetch` com o comentário
inserido sem reload, botão apagar só no próprio.
**Aceite.** Testes de integração com caminho feliz **e** erro por rota (sem sessão, conteúdo vazio,
post inexistente, apagar de outro). Nenhum teste existente alterado.

**Feito (E1a).** `CommentController.create/listByPost/remove`, `requireOwnComment` em
`auth/middleware.ts`, rotas em `comments/commentRoutes.ts` (`POST`/`GET /posts/:id/comments`,
`DELETE /comments/:id`) registradas em `server.ts`. 14 testes novos em
`test/integration/comments.routes.test.ts` (total 100). Provado no servidor real: `authorId` do corpo
ignorado (autoria da sessão), 403 ao apagar comentário alheio, 204 no próprio, 400 em conteúdo vazio.

**Feito (E1b).** UI no feed: cada post mostra os 3 primeiros comentários (com autor), um formulário
e o botão "apagar" só no comentário do próprio usuário. `public/feed.js` ganhou `createComment` e
`deleteComment` na **mesma** delegação de `#feed` (nada de listener por botão), montando o `<li>`
com `textContent` (sem `innerHTML` com dado de usuário) e atualizando o contador do rodapé.
Comentário **não** é otimista de propósito: o texto e o id vêm da resposta 201; inventar um
comentário antes exigiria inventar id e autor (a curtida continua otimista, porque é binária).
Fallback sem JS preservado: `POST /posts/:id/comments` e o novo `POST /comments/:id/delete`
redirecionam. 3 testes de view novos (total 110) e verificação no **navegador real**: comentar e
apagar sem reload, contador de 0 → 1 → 0.
**Risco.** `Comment` tem `parentId` (respostas): decidir se a UI já cria resposta em thread ou se fica para depois — registrar a decisão, não deixar meio-feito.

## E2 — curtida em comentário (atividades 3 e 8) — ✅ concluído em 31/10

**Escopo.** `toggleCommentLike` no `LikeController` (sem migração: `Like.commentId` + `@@unique` já
existem), rotas `POST`/`DELETE /comments/:id/like`, botão por comentário e `feed.js` generalizado
para os dois alvos.
**Feito (E2a).** `toggleCommentLike`/`unlikeComment`/`commentLikeState` no `LikeController` e
`POST`/`DELETE /comments/:id/like` em `likes/likeRoutes.ts` — **sem migração**: a tabela `Like` já
aceitava `commentId` com `@@unique([userId, commentId])` e CHECK de alvo exclusivo (ADR-0002).
`CommentNotFoundError` mapeado para 404. 7 testes novos (`comment-likes.routes.test.ts`, total 117);
provado no servidor real: toggle 1→0, dois usuários somam 2, DELETE idempotente, 302 sem sessão, 404
inexistente, 400 id malformado, e no banco o like aparece com `postId` nulo e `commentId` preenchido.

**Feito (E2b).** `views/partials/comment.ejs` passou a renderizar o comentário (autor, conteúdo,
curtida e "apagar") — usado pelo feed **e** pela página do post, acabando com o markup duplicado que
o E1b deixou. `UserController.feed` e `PostController.getForView` preenchem `_count.likes` e
`likedByMe` por comentário com **uma** consulta por página (não uma por comentário). No
`public/feed.js`, o `LIKE_FORM` virou `form[action$="/like"]`: o mesmo `toggleLike` serve post e
comentário, sem bifurcação. 3 testes novos (120 no total) e verificação no navegador com as três
fases do item 8: otimista (contagem 1→0 em 0,4 s, botão desabilitado), falha de rede simulada e
rollback (volta a 1 com a mensagem "Não foi possível curtir agora.").

**Aceite.** Toggle, contagem isolada por alvo, 404, auth, duplicidade (`P2002`), otimista com
rollback verificável com rede lenta.

## E3 — múltiplas fotos (atividade 4) — ✅ concluído em 31/10

**Bloqueado até a decisão `PostImage` × `Image`** (cartão E3a → gera ADR-0009).
**Escopo.** Migração em três passos (criar → `INSERT ... SELECT` de `Post.imageUrl` → remover
coluna), `upload.array('images', 5)` com um `imageStorage.upload()` por arquivo, views e testes.
**Feito (E3b).** ADR-0009 decidido pelo enunciado: `PostImage (id, url, order, postId)` com
`@@unique([postId, order])` e `onDelete: Cascade`; `Image` continua como arquivo do usuário e
`Image.postId` fica legado. Migration `20261031230000_add_post_image` gerada com
`prisma migrate diff` (o `migrate dev` recusa rodar sem TTY neste ambiente) e **editada à mão** para
incluir o passo de dados entre o `CREATE TABLE` e a reconstrução de `Post`:

```sql
INSERT INTO "PostImage" ("url", "order", "postId")
SELECT "imageUrl", 0, "id" FROM "Post" WHERE "imageUrl" IS NOT NULL;
```

**Provado com dado real**: criei um post com foto pelo código antigo (post 13, `imageUrl =
/uploads/b48cff80-….png`), apliquei a migration e conferi no `dev.db` — `PostImage` ganhou a linha
`(url, order 0, postId 13)` e a coluna `imageUrl` deixou de existir. Em banco novo o passo roda e não
seleciona nada (a coluna só existe até esta migration).

**Feito (E3c).** `upload.array('images', 5)` em `POST /posts`, **um `imageStorage.upload()` por
arquivo** em sequência (é a ordem do laço que define `PostImage.order`), `PostController.create`
recebendo `string[]`, includes ordenados por `order` nas três leituras (feed, página do post, API),
`newPost.ejs` com `multiple`, e o seed agora tem um post com 2 fotos (`placehold.co`, sem binário no
repo). 6 testes novos em `post-images.test.ts` (total 126). No servidor real: 3 arquivos → 3 linhas
com `order` 0/1/2 e URLs distintas; 6 arquivos → 400; feed mostra a 1ª foto e "+ 1 foto(s)"; página
do post mostra as duas na ordem.

## E4 — carrossel (atividade 5) — ✅ concluído em 31/10

**Feito.** `views/partials/carousel.ejs` (0 foto → nada; 1 → `<img>` como antes; 2+ → carrossel) e
`public/carousel.js` em JS puro: setas, indicadores, navegação circular, teclado (← →), `aria-live`
anunciando "Foto N de M" e `aria-hidden` nos slides fora de vista. O estado vive em `data-index` no
nó, não em closure. Dois detalhes de layout que importam: o carrossel foi colocado **fora** do `<a>`
do post (botão dentro de link é inválido e o clique navegaria), e os botões são `type="button"`.

**Provado no navegador:** `[data-carousel]` no feed, 2 slides, 2 dots; next → index 1,
`translateX(-100%)`, "Foto 2 de 2", `aria-current` no dot certo; next de novo volta ao 0 (circular);
`ArrowRight`/`ArrowLeft` funcionam; URL não muda e **0 requisições novas** (é tudo cliente).
Teste de view: carrossel presente com 2 fotos e ausente com 1 (127 testes).
**Aceite.** HTML com controles apenas com mais de uma foto; navegar não dispara requisição.

## E5 — feed paginado e scroll infinito (atividade 6) — ✅ concluído em 31/10

**Bloqueado até a decisão “fragmento HTML × JSON”** (cartão E5a → ADR-0010). Cursor já é decisão
tomada (ADR-0005): `?cursor=&limit=`, ordenação `createdAt desc, id desc`.
**Feito (E5b).** ADR-0010 (fragmento HTML). `partials/postCard.ejs` extraído — o markup do card
passou a existir **uma** vez, usado pelo `GET /` e pelo endpoint. `UserController.feedPage(userId,
{cursor, limit})` é a consulta única: cursor **composto** (`createdAt` + `id`, em base64url),
`orderBy [{createdAt: desc}, {id: desc}]`, `take: limit + 1` para saber se há próxima página sem
`count()`. `GET /` passa `nextCursor` para o sentinela; `GET /feed/more?cursor=&limit=` devolve o
fragmento com `X-Next-Cursor` no header (ausente = fim). 7 testes novos (total 134), incluindo o que
cria posts **empatados no mesmo segundo** (o caso em que só data quebraria) e verifica que as duas
páginas não repetem nem omitem id.

**Feito (E5c).** `IntersectionObserver` no sentinela (`rootMargin: 200px`), `insertAdjacentHTML`
antes dele, cursor atualizado pelo header, `finally` reabilitando em erro e mensagem visível. No
navegador: 10 cards → scroll → **15 cards**, sentinela removido, aviso de fim aparecendo, URL intacta
e **1 requisição** a `/feed/more`. E o teste que fecha o argumento do ADR-0004: curtir um card que
veio do fragmento funcionou sem listener novo (`liked=1`, contagem 1).
**Aceite.** Páginas consecutivas sem repetir nem omitir; DevTools mostra só `fetch`; curtir e
comentar posts carregados por scroll funcionam sem listener novo (é o que prova a delegação de
eventos da discussão item 4).

## E6 — acabamento (atividades 7, 9 e 10)

| Cartão | Escopo                                                                    | Aceite                                                                              |
| ------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| E6a ✅ | `PATCH /comments/:id`, edição inline                                      | próprio 200, de outro 403, vazio 400, 404                                           |
| E6b    | comentários por `_count.likes` (consulta própria, fora do `buildOrderBy`) | mais curtido primeiro, empate estável                                               |
| E6b-2  | mesma entrega, 2ª tentativa (a 1ª foi descartada)                          | idem, com o código no repo e revisado                                               |
| E6c    | `User.lastSeenAt` + contador de novidades                                 | conta like/comment de terceiros nos meus posts, não os meus, zera no próximo acesso |

### E6b — descartado na 1ª tentativa (31/10)

Um worker do board executou o E6b fora de hora e o cartão foi marcado `done`, mas o código não passou
por revisão e ficou **fora do commit** `7431297` — `src/comments/commentListing.ts`, o teste
`comment-sort-likes.routes.test.ts` (13 testes) e a troca de `buildOrderBy` por `parseCommentListing`
em `CommentController`. Isso não é perda de trabalho: os arquivos estão em
`~/.hermes/cache/scratch/worker-e6b-abortado/`, e a decisão entre reintegrar e reimplementar está no
cartão **E6b-2**. A lição operacional está na skill `kanban-backlog-planning`: um cartão por vez,
`unblock && claim` na mesma linha, e `git status` depois de qualquer worker morto.

### E6a — editar o próprio comentário — ✅ concluído em 31/10

`CommentController.update(commentId, body)` reaproveita **a mesma** validação do `create` (obrigatório,
trim, limite de 2000) — regra duplicada em outro método é a divergência que o trabalho pede para
evitar — e devolve o comentário com `author` público e `_count.likes`.

Duas rotas, um efeito (ADR-0004): `PATCH /comments/:id` devolve JSON para o `fetch` do feed;
`POST /comments/:id/edit` é o fallback do `<form>` sem JavaScript, que redireciona. As duas passam por
`requireAuth` + `requireOwnComment`, então a autorização não depende do verbo.

Na UI, o botão "editar" troca o texto por um campo inline (foco no fim do texto, `Esc`-equivalente pelo
botão "cancelar"), e o `updateComment` do `feed.js` manda `PATCH` e atualiza o `<span>` no lugar. Dois
detalhes que só a verificação no navegador mostrou:

- o comentário recém-criado também ganhou os botões (antes só o partial os tinha, e o comentário novo
  ficaria sem edição até a próxima recarga);
- o espaço entre autor e texto era um `' '` dentro do `textContent` do comentário, então **editar
  apagava a separação** ("Carlaespaco DEPOIS..."). Corrigido movendo o espaço para `mr-1` no `<strong>`,
  onde reescrever o texto não o destrói.

`(editado)` aparece comparando `updatedAt > createdAt` — sem campo novo de "editado" no schema.
7 testes novos (total **140**): próprio 200 com trim, alheio 403 sem mudar o texto, vazio/limite/id
malformado 400, sem sessão 302, inexistente 404, fallback com redirect e a marca na view.

## E7 — fechamento

1. README da raiz: link para `docs/`, headings `# Item N` → `##`, decisões finais (texto do autor).
2. Cobertura (`npm run test:coverage`) + revisão item por item contra o enunciado.
3. Roteiro da gravação de 15 min e checklist de entrega.

## Onde cada critério de rubrica é provado

| Critério do enunciado                           | Provado por                                                 |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Testes passam, sem regressão da Aula 05         | suíte inteira em cada cartão                                |
| Cobertura: feliz + erro por funcionalidade nova | testes de integração em E1, E2, E3, E4, E5, E6              |
| Autorização sempre da sessão                    | `requireAuth`/`requireOwnComment` e testes de 403           |
| Fronteira de módulo                             | tabela em `arquitetura/c4.md` (nível 3a) + `ADR-0001`       |
| Migração sem perda de dados                     | teste da migração em E3b                                    |
| UI sem reload                                   | DevTools nos cartões E1b, E2b, E4, E5c, E6a                 |
| Registro de decisões                            | `docs/adr/` 0001–0010 + `README.md` (discussão obrigatória) |

## Decisões que travam o backlog

| Cartão | Decisão                                     | Consequência de errar                           | Estado            |
| ------ | ------------------------------------------- | ----------------------------------------------- | ----------------- |
| E3a    | `PostImage` novo × reaproveitar `Image`     | define a migração inteira do item 4             | decidida (0009)   |
| E5a    | fragmento HTML × JSON + template no cliente | duplica ou não o markup do card em dois lugares | decidida (0010)   |
| E6c    | semântica do primeiro acesso (`lastSeenAt` nulo) | define o que conta como "novidade" para quem nunca entrou | **em aberto** |
