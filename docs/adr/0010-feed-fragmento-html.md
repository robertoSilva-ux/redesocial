# ADR-0010 — Feed paginado devolve **fragmento HTML**, não JSON + template no cliente

- **Status:** Aceita
- **Data:** 2026-10-31
- **Decisores:** Roberto (autor do projeto)
- **Relaciona-se com:** ADR-0004 (formulário + `fetch`), ADR-0005 (paginação), ADR-0001 (módulos)

## Contexto

O item 6 do Trabalho II pede o feed carregando mais posts via `fetch`, sem recarregar a página, com
paginação incremental. O enunciado sugere um endpoint paginado (`GET /api/feed?cursor=&limit=10`) e
deixa aberto o **formato da resposta** — o que ele cobra é o comportamento: "inserindo os posts no
DOM sem recarregar".

Medido no feed real antes da decisão (dev.db semeado, login como usuário do feed):

| Payload | bytes | gzip |
| --- | --- | --- |
| `<article>` do post renderizado | 4.940 | 1.537 |
| JSON de um post (`/api/posts`) | 264 | 208 |

O card é grande porque carrega markup, não dado: 2 SVG inline (764 B), 29 atributos de classe,
carrossel (E4), formulário de comentário e a lista dos 3 comentários.

E há um precedente no mesmo arquivo: o comentário novo (E2b) **já** é montado no cliente a partir do
JSON do `201`. Ou seja, o projeto já convive com os dois estilos.

## Decisão

O endpoint devolve **HTML renderizado no servidor**, a partir de um partial único, e o cliente só
insere o que chegou:

```
GET /feed/more?cursor=<b64>&limit=10
→ 200 text/html            corpo: N cards prontos (<article>…</article>)
→ header X-Next-Cursor     cursor do próximo lote; ausente/vazio = fim da lista
```

- o markup do card vive em **um** lugar: `src/views/partials/postCard.ejs`, usado pelo `feed.ejs`
  (primeira página) e pelo endpoint (páginas seguintes);
- o cliente (`public/feed.js`) faz `insertAdjacentHTML('beforebegin', html)` no sentinela — nenhum
  `createElement` para card, nenhuma reimplementação de `aria-*`;
- a paginação é por **cursor composto** (`createdAt` + `id`, codificado em base64), não por
  `page/pageSize`: sem deslocamento de resultados quando um post novo entra no topo (ADR-0005 já
  registrava essa convivência);
- a primeira página também calcula o cursor (o `GET /` passa `nextCursor` para a view), então o
  cliente continua de onde a renderização inicial parou.

## Alternativas consideradas

- **JSON + template no cliente.** Payload ~7× menor por card. Descartado porque o markup do card
  passaria a existir em dois lugares (EJS e JS) e as duas cópias divergem — foi exatamente o que
  aconteceu no E1b, quando o markup do comentário nasceu duplicado entre `feed.ejs` e `post.ejs` e o
  E2b teve de extrair um partial para consertar. Com card de 5 KB, com carrossel e condicionais
  (`apagar` só no próprio, tags, contadores), a cópia em JS seria bem maior que a do comentário.
  O ganho de banda só se paga com **segundo consumidor** — que não existe aqui.
- **JSON + `<template>` declarado no `feed.ejs`.** Melhor dos dois mundos em payload e em fonte única;
  o custo é que o `<template>` não tem lógica de servidor (loop de tags, "apagar" condicional,
  inicialização do carrossel), então metade do card voltaria para o JS. É a escolha de um produto
  que precise da API e do HTML; num projeto de disciplina, é complexidade sem retorno.
- **Manter tudo server-rendered com links de "próxima página".** Simples e sem JS, mas é o
  comportamento que a atividade 6 pede para substituir.

## Consequências

### Positivas

- Um dono para o markup do card: mudar o card é editar `postCard.ejs` uma vez.
- Escaping é o do EJS (`<%= %>`) — nenhum caminho novo para XSS por `innerHTML` com dado de usuário.
- Acessibilidade e carrossel vêm prontos do servidor; o JS do cliente só move nós.
- A delegação de eventos do `feed.js` (ADR-0004) cobre os cards inseridos sem trabalho extra — é a
  razão de ela existir.

### Negativas / custos

- **O endpoint serve só este cliente.** Um app mobile futuro precisaria de um `/api/feed` JSON. A
  consulta paginada já existirá (`UserController.feedPage`), faltará o formato — barato, mas é
  trabalho que não está feito.
- **Resposta maior**: ~15 KB gzip por página de 10 posts, contra ~2 KB em JSON. Irrelevante nesta
  escala; relevante se o feed virar lista infinita de milhares de itens.
- O cursor viaja em **header** (`X-Next-Cursor`), não no corpo: um cliente que não leia headers não
  consegue paginar. Fica documentado aqui e no código da rota.
- `insertAdjacentHTML` insere string no DOM: o conteúdo é nosso (renderizado no servidor), mas é um
  ponto que exige disciplina — qualquer dia que alguém passar dado de usuário por `raw` no EJS, o
  risco volta.

### Riscos e mitigação

- **Divergência entre a primeira página e as seguintes** (a view e o endpoint usarem consultas
  diferentes). Mitigação: os dois chamam o **mesmo** `UserController.feedPage`; a única diferença é
  o cursor.
- **Repetir ou omitir post na virada de página** (o motivo de cursor em vez de offset, e de desempate
  por `id` quando o `createdAt` empata no segundo). Mitigação: teste de duas páginas consecutivas que
  compara os ids com os da consulta completa.
- **Erro de rede no meio do scroll** deixando a lista travada. Mitigação: o cliente reabilita o
  envio no `finally` e mostra a mensagem; o próximo scroll tenta de novo.

## Referências

- Enunciado: `tads-webii-2026-2/TRABALHOS/TRABALHO II.md`, atividade 6 e Discussão obrigatória item 4
- `src/views/partials/postCard.ejs`, `src/views/feed.ejs`, `public/feed.js`, `src/webRoutes.ts`
- `src/users/UserController.ts` (`feedPage`), `src/shared/pagination.ts`
- ADR-0004 (delegação de eventos), ADR-0005 (paginação por offset na API × cursor no feed)
