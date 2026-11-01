# ADR-0011 — Listagem de comentários negocia conteúdo: JSON por padrão, fragmento HTML quando o cliente pede

**Status:** Aceita
**Data:** 31/10/2026
**Contexto do trabalho:** Trabalho II, atividade 9 (ordenar comentários por mais curtidos)

## Contexto

A ordenação por curtidas (`?sort=likes`) ficou no backend, no módulo `comments/`, porque é uma
ordenação **por relação** — `_count` da relação `likes` — e o `buildOrderBy` de
`shared/pagination.ts` só monta `orderBy` por coluna (limite já registrado na ADR-0005).

Faltava a interface. Ela precisava de dois caminhos ao mesmo tempo:

1. **sem JavaScript** — trocar a ordem tem de funcionar, porque é assim que o ADR-0004 resolve toda
   interação deste projeto;
2. **com JavaScript** — trocar a ordem **sem recarregar** a página, que é o comportamento que o
   critério de avaliação do trabalho cobra ("UI funcional sem reload").

O projeto já tinha duas decisões vizinhas: o ADR-0010 escolheu **fragmento HTML** para o feed
paginado (o servidor renderiza o card, o cliente insere), e o ADR-0004 fixou "a rota serve os dois
clientes" para **escrita** (JSON para o `fetch`, redirect para o `<form>`). O que faltava decidir era
a **leitura** poder servir dois formatos.

## Decisão

`GET /posts/:id/comments` passa a **negociar conteúdo**, sem rota nova:

| Cliente | Pedido | Resposta |
| --- | --- | --- |
| API / `fetch` do feed | `Accept: application/json`, ou nenhum `Accept` (curl) | `{ data, meta }` — o contrato de sempre |
| Página do post, sem JS | navegação com `?sort=` | página inteira, renderizada pelo servidor |
| Toggle com JS | `Accept: text/html` **e** sessão | fragmento com o partial `comment.ejs` + header `X-Total` |

O fragmento é montado com `ejs.renderFile` sobre o **mesmo** `partials/comment.ejs` que a página
usa, e a decisão de qual formato sai fica na rota (`commentRoutes.ts`), não no controller: o
controller continua devolvendo dados paginados.

A página do post deixou de ler os comentários do `include` do post (`PostController.getForView`) e
passa a pedi-los ao `CommentController.listByPost`, com `viewerId` da sessão. A composição acontece
na borda (`webRoutes.ts`); `posts/` não importa `comments/` (ADR-0001).

## Alternativas descartadas

* **Rota separada `/posts/:id/comments/fragment`.** Não sobrecarrega o contrato existente, mas cria
  dois caminhos para a mesma leitura e obriga o cliente a conhecer os dois; o `GET` da listagem já
  existia e já era chamado pela mesma tela.
* **Montar o markup no cliente a partir do JSON.** É o que o `feed.js` faz no comentário recém-criado
  (~3 linhas) e justamente o que **não** escala para uma lista: o card do comentário tem curtida
  com estado, botões de dono e campo de edição. Foi esse tipo de duplicação que o E2b teve de
  desfazer, extraindo o partial.
* **HTML como padrão e JSON só com `Accept` explícito.** Quebraria o contrato das outras listagens
  (`/api/comments`, `/api/posts`) e os testes existentes, que chamam sem header.

## Consequências

**Positivas.** Um único dono do markup do comentário (o partial), usado pela página, pelo fragmento
e — no dia em que existir — por qualquer outro cliente. A ordenação, a paginação e o `likedByMe`
vivem num lugar só (`comments/`), então a página do post e a API não podem divergir. Sem JS continua
funcionando: os links de ordenação são `href` de verdade.

**Negativas — e são reais.**

1. **O contrato de leitura ficou mais largo.** O mesmo `GET` responde dois formatos, então um teste
   de contrato não basta: são dois (JSON e fragmento). Quem consumir a rota precisa saber que o
   header decide.
2. **O fragmento depende da sessão.** Sem `viewerId` não há `likedByMe` para desenhar, e o botão de
   curtida sairia sempre apagado; por isso, sem sessão a rota responde JSON mesmo com
   `Accept: text/html`. É uma exceção ao "negocie pelo header" que precisa estar escrita — este
   parágrafo é o registro.
3. **Não é cacheável por CDN.** A resposta depende de cookie de sessão e de `Accept`; cache
   intermediário exigiria `Vary: Cookie, Accept`. No escopo do trabalho não há CDN.
4. **Uma consulta a mais na página do post.** Antes os comentários vinham no `include` do post
   (uma consulta); agora são duas (post + listagem de comentários) mais a de `likedByMe`. É o preço
   de não ter a regra de ordenação duplicada em `posts/`.
5. **`?sort=likes&order=asc` é ignorado em silêncio**: a ordenação por curtidas é sempre "mais
   curtidos primeiro", e o `meta` reporta `order: 'desc'` de fato usado. Decisão consciente
   registrada aqui; a alternativa (400) seria mais explícita, mas o requisito é uma direção só.
