# Documentação do projeto

Este diretório guarda o **porquê** das decisões — o código e o `README.md` da raiz explicam o
**quê** e o **como**.

```
docs/
├── README.md              este índice
├── BACKLOG.md             especificação do Trabalho II em incrementos (E0..E7)
├── adr/                   Architecture Decision Records (um arquivo por decisão)
│   ├── README.md          índice, convenção e template
│   ├── 0001 ... 0011      decisões aceitas
└── arquitetura/
    └── c4.md              diagramas C4: contexto (1), containers (2) e componentes (3)
```

## Por que ADR

O enunciado do Trabalho II pede o *registro das decisões* e o critério de avaliação cobra que
elas estejam identificáveis. O `README.md` responde às perguntas da discussão obrigatória em
prosa; o ADR faz o mesmo no formato canônico — **contexto, decisão e consequências** — para que
cada escolha tenha um registro datado, com as alternativas que foram descartadas e o custo que
ela impõe depois. A diferença prática: prosa explica a escolha para quem lê hoje; o ADR impede
que a mesma discussão seja refeita daqui a três semanas, porque o custo já está escrito.

## Por que C4

O diagrama de containers mostra onde cada módulo roda e quem fala com quem. Serve para três
coisas concretas neste projeto: (1) provar que `posts/`, `comments/` e `likes/` não se importam
entre si; (2) mostrar que o Prisma é a única porta para o banco; (3) mostrar que `ImageStorage`
é a costura entre a aplicação e o S3 — a única peça que troca sem tocar em controller.

## Regras de manutenção

1. **Decisão nova = ADR novo.** Não editar ADR aceito; para mudar de ideia, escrever um novo com
   `Status: Aceita` e marcar o antigo como `Substituída por ADR-XXXX`.
2. **Diagrama junto da mudança.** Módulo novo (`carousel/`, `feed/`), rota nova de interação ou
   dependência externa nova → atualizar `arquitetura/c4.md` **no mesmo commit** da feature. Um C4
   desatualizado é pior que nenhum: mente com aparência de fonte primária.
3. **ADR sem consequência negativa é propaganda.** Toda decisão tem custo; se o custo não está
   escrito, a análise está incompleta.

## Convenções que o código já assume

* **Nenhum `include` traz a linha inteira de `User`.** Lista, busca e detalhe usam
  `publicUserSelect` (`src/shared/selects.ts`): `author: true` foi o que vazou `passwordHash` em
  `/api/users/:id`, `/api/posts/:id` e `/api/users/:id/feed`. Controller novo segue a mesma regra.
* **Erro 5xx não devolve mensagem interna.** O detalhe vai para o log do servidor
  (`src/shared/errorHandler.ts`); o cliente recebe "Erro interno do servidor".
* **`:id` de rota passa por `parseIdParam`** (`src/shared/http.ts`): id malformado é 400, nunca 500 do Prisma.
* **Identidade vem da sessão, nunca do corpo.** `authorId`, `userId` e `followerId` são lidos de
  `req.session.userId` na borda e passados como parâmetro ao Controller; o valor do corpo é ignorado
  (há teste disso em `comments.routes.test.ts`).
* **Toda rota de escrita serve dois clientes** (`ADR-0004`): JSON quando o `fetch` manda
  `Accept: application/json`, redirect quando é `<form>`. Quem adiciona interação nova implementa os
  dois caminhos — e, se a ação precisa de verbo que `<form>` não faz (DELETE, PATCH), ganha também
  um fallback POST (ex.: `POST /comments/:id/delete` e `POST /comments/:id/edit`, que acompanha o
  `PATCH /comments/:id`).
* **Listagem serve JSON por padrão e fragmento HTML quando o cliente pede** (ADR-0011): o `fetch`
  manda `Accept: text/html` e recebe o partial renderizado; API e `curl` continuam recebendo
  `{ data, meta }`. Rota de leitura nova segue o mesmo critério, sem endpoint `/fragment` paralelo.
* **Estado de UI que o servidor pode calcular vem do servidor.** O link ativo da ordenação sai do
  `?sort=` renderizado, não do clique; o `commentSort.js` só pinta de novo depois do `fetch`. Se o
  `fetch` falhar, a tela continua mostrando o estado verdadeiro.
* **Editar texto reescreve o dado, não a apresentação.** Quando o JS troca o conteúdo de um nó
  (`span.textContent = ...`), tudo o que estava dentro dele se perde — inclusive separação e
  ênfase escritas como parte do texto. Foi o que aconteceu na edição de comentário: o espaço entre
  autor e comentário era um `' '` concatenado no `textContent` e desaparecia a cada edição. Espaço,
  negrito e cor ficam no markup (`mr-1`, `<strong>`), nunca no valor.
* **Atualização otimista só quando o estado é binário e reversível.** Curtida pinta antes da resposta
  e desfaz se falhar; comentário espera o `201`, porque o texto e o id vêm do servidor — inventar um
  comentário antes exigiria inventar id e autor. A regra está em `public/feed.js`, lado a lado com as
  duas implementações.

## Pendências conhecidas (não são decisões tomadas)

Registradas aqui para não se perderem; viram ADR quando forem decididas.

- **`Like` × `CommentLike`** — o enunciado nomeia duas tabelas; existe uma só, polimórfica
  (ADR-0002). Se a decisão for separar, o ADR-0002 é substituído.
- **`PostImage`** — decidido no ADR-0009: tabela própria, migrando `Post.imageUrl` com passo de
  dados. `Image` continua sendo "arquivo do usuário" e `Image.postId` fica como legado do Exercício 1.
- **Feed do scroll infinito**: decidido no ADR-0010 — fragmento HTML renderizado no servidor,
  cursor composto (`createdAt` + `id`) via header `X-Next-Cursor`. Convivência com `page/pageSize`
  da API de leitura já registrada no ADR-0005.
- **Ambiente**: resolvido no ADR-0008 (override global de `better-sqlite3` + lock regenerado).
  Sintoma de regressão: suíte inteira vermelha com `Module did not self-register` — conferir com
  `npm ls better-sqlite3` (duas cópias = override perdido).
