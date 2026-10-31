# Aula 04 — Rede social mínima (Prisma)

Aula de camada de persistência com ORM. Uma API HTTP mínima de rede social, modelada com Prisma sobre SQLite, cobrindo as três formas de relação que a aula precisa demonstrar:

* **1:N** — `User → Post` (um autor tem muitos posts).
* **N:N implícita** — `Post ↔ Tag` (o Prisma cria e gerencia a tabela de junção sozinho).
* **Autorrelação N:N** — `User ↔ User` via `Follow` (seguidores/seguindo), com tabela de junção **explícita** porque há duas relações diferentes com `User` no mesmo model.

Ver o schema completo em [`prisma/schema.prisma`](prisma/schema.prisma).

## Rodando

```bash
npm install              # também roda `prisma generate` (postinstall)
npm run prisma:migrate    # cria dev.db e aplica a primeira migration
npm run prisma:seed       # popula com 3 usuários, 3 posts, 2 tags, 3 follows
npm run dev                 # sobe a API em http://localhost:3003
npm test                     # suíte de integração (usa um SQLite dedicado, test.db)
```

`npm run prisma:studio` abre o Prisma Studio (GUI) para inspecionar as tabelas — útil para mostrar em aula a tabela de junção implícita `_PostToTag`, que não existe no schema mas existe no banco.

### Notas de ambiente (ler antes de culpar o código)

* **Prisma Studio + SQLite no Prisma 7**: o CLI rejeita o `file:./dev.db` (relativo) que vem do `.env` com `! Prisma Studio is not supported for the "file:./dev.db" protocol.` — bug aberto em [`prisma/studio#1578`](https://github.com/prisma/studio/issues/1578). O Studio só aceita `file://` **com caminho absoluto**. Por isso o script `npm run prisma:studio` não chama o CLI direto: ele passa por [`scripts/prisma-studio.mjs`](scripts/prisma-studio.mjs), que converte o `DATABASE_URL` relativo para `file://<caminho absoluto>` e só então abre o Studio. Se quiser chamar na mão: `npx prisma studio --url="file://$PWD/dev.db"`.
* **npm bloqueia install scripts de dependências** (a partir do 11.16). O `postinstall` do próprio projeto (`prisma generate`) roda normalmente; o que não roda são os scripts dos pacotes instalados. Liberação é por pacote, com `npm approve-scripts <pacote>`. O `better-sqlite3` **não precisa** disso: desde o ADR-0008 a versão usada é a 13.0.3, que vem com binário pré-compilado em `prebuilds/` — se a suíte inteira falhar com `Module did not self-register`, o problema é uma segunda cópia do pacote, e `npm ls better-sqlite3` mostra isso em um comando. Depois de mudar o schema, `npx prisma generate` continua sendo necessário (ver nota abaixo).
* **`prisma migrate dev` não regenerou o client neste ambiente** (verificado: `node_modules/.prisma/client/index.d.ts` ficou sem os models novos depois da migration). Regra prática: **depois de qualquer mudança de schema, rode `npx prisma generate` explicitamente** antes de rodar o seed ou a suíte, senão os delegates novos aparecem como `undefined` em runtime e o tsc/LSP acusa `Property 'x' does not exist on type 'PrismaClient'`.
* **Checksum de migration divergente**: se o Prisma reclamar `The migration ... was modified after it was applied` e quiser rodar `migrate reset` (apagando `dev.db`), verifique antes se a diferença é só cosmética:
  ```bash
  python3 -c "import sqlite3,hashlib;con=sqlite3.connect('file:dev.db?mode=ro',uri=True);stored={r[0]:r[1] for r in con.execute('select migration_name,checksum from _prisma_migrations')};import glob,os;[print(os.path.basename(os.path.dirname(d)), hashlib.sha256(open(d,'rb').read()).hexdigest()==stored.get(os.path.basename(os.path.dirname(d)))) for d in sorted(glob.glob('prisma/migrations/*/migration.sql'))]"
  ```
  Uma linha em branco a mais no `migration.sql` basta para o checksum divergir. Correção correta: remover a diferença e devolver o arquivo ao sha256 original (nenhum dado é perdido) — não usar `migrate reset` sem antes confirmar que a diferença é de whitespace.

### Testando manualmente com [`test.http`](test.http)

Com a extensão **REST Client** (Huachao Mao) instalada no VS Code, abra [`test.http`](test.http) e clique em "Send Request" acima de cada bloco. O arquivo cobre o fluxo completo (criar usuários, seguir, criar posts com tags, feed, busca por tag) e uma seção de casos de erro (400/404/409) — os requests estão encadeados via variáveis nomeadas (`{{createAna.response.body.$.id}}`), então rode de cima para baixo na primeira vez.

## Endpoints

| Método | Rota | O que demonstra |
| --- | --- | --- |
| `POST /users` | cria usuário (`{ name, email }`) | — |
| `GET /users/:id` | usuário + `_count` de posts/seguidores/seguindo | contagem via relação |
| `POST /users/:id/follow` | segue outro usuário (`{ targetId }`) | **autorrelação N:N** |
| `POST /posts` | cria post (`{ authorId, content, tags?: string[] }`) | **1:N** (`connect`) + **N:N** (`connectOrCreate`) na mesma escrita |
| `GET /posts/:id` | post com autor e tags | `include` |

### Listagens (todas paginadas e ordenáveis — Exercício 2)

Aceitam `?page=&pageSize=&sort=&order=` e devolvem **sempre** o mesmo envelope:

```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 10, "total": 12, "totalPages": 2, "hasNext": true, "sort": "createdAt", "order": "desc" } }
```

| Método | Rota | Entidade | Campos aceitos em `sort` |
| --- | --- | --- | --- |
| `GET /posts` | todos os posts (com autor, tags e `_count` de comentários/likes) | Post | `createdAt`, `id` |
| `GET /comments` | todos os comentários (com autor e `_count` de respostas/likes) | Comment | `createdAt`, `id` |
| `GET /likes` | todos os likes (com usuário e o alvo) | Like | `createdAt`, `id` |
| `GET /profiles` | todos os perfis (com o usuário) | UserProfile | `createdAt`, `id`, `displayName` |
| `GET /images` | todas as imagens (com dono e post) | Image | `createdAt`, `id` |
| `GET /users/:id/feed` | posts de quem o usuário segue | Post | `createdAt`, `id` |
| `GET /tags/:name/posts` | posts de uma tag | Post | `createdAt`, `id` |

Regras: `page` começa em 1 · `pageSize` vai de 1 a 100 (padrão **10**) · `order` é `asc` ou `desc` (padrão `desc`, mais recentes primeiro) · `sort` só aceita os campos da tabela acima — qualquer outro valor devolve **400** dizendo quais são válidos:

```bash
curl 'localhost:3003/posts?pageSize=5&sort=createdAt&order=asc'
curl 'localhost:3003/posts?sort=senha'   # 400: "sort" deve ser um destes campos: createdAt, id
curl 'localhost:3003/posts?pageSize=101' # 400: "pageSize" deve estar entre 1 e 100
```

Dois detalhes de implementação (em [`src/shared/pagination.ts`](src/shared/pagination.ts)) que valem a discussão em aula:

1. O `orderBy` **sempre** leva um desempate por `id`. `createdAt` no SQLite tem resolução de **segundo**, então linhas inseridas no mesmo segundo empatam — sem um critério estável, a página 2 pode repetir (ou pular) itens da página 1. Corrigido, e tem teste para isso.
2. A paginação acontece **no banco**: `skip`/`take` viram `LIMIT`/`OFFSET`. Note que `GET /tags/:name/posts` deixou de carregar `tag.posts` inteiro e passou a filtrar por relação, senão o corte só valeria depois de trazer tudo para a memória.
3. `total` vem de um `count()` em paralelo com o `findMany` (`Promise.all`) — são duas queries, não uma.

## Estrutura

```
prisma/
├── schema.prisma   → os 4 models e as 3 relações
└── seed.ts          → dados de exemplo

src/
├── db.ts                    fábrica de PrismaClient
├── users/UserController.ts   create, get, follow, feed (paginado)
├── posts/PostController.ts   create, get, list (paginado), listByTag (paginado)
├── comments/CommentController.ts    list (paginado)
├── likes/LikeController.ts          list (paginado)
├── profiles/UserProfileController.ts list (paginado)
├── images/ImageController.ts        list (paginado)
├── shared/                   erros de domínio, error handler, asyncHandler, pagination
├── routes.ts, server.ts, index.ts

test/
├── globalSetup.ts            aplica as migrations no banco de teste antes da suíte
├── helpers/testDb.ts          PrismaClient de teste + reset de tabelas
└── integration/               rotas testadas ponta a ponta com Supertest + SQLite real
```

De propósito, os Controllers chamam o Prisma Client diretamente — **não há repositório nem porta de persistência ainda**. Essa separação (arquitetura em camadas/hexagonal, isolando o domínio do Prisma) é o tema da Aula 05, que reaproveita este mesmo Prisma Client como adaptador.

## Testes: por que usam SQLite real, não mocks

`test/globalSetup.ts` roda `prisma migrate deploy` contra um `test.db` isolado antes da suíte, e cada teste começa com `resetDatabase()` (limpa as tabelas na ordem certa: `Follow → Post → Tag → User`). Isso segue a mesma filosofia das Aulas 02/03: testar a colaboração real com o ORM, não uma simulação dele — um mock de Prisma não pegaria, por exemplo, uma violação de unicidade (`P2002`) real.

## Atividade em sala

1. Rodar `npm run prisma:studio` e abrir a tabela `_PostToTag` — perguntar: "isso está em algum lugar do `schema.prisma`?" (resposta: não, o Prisma cria sozinho).
2. Seguir o fluxo `POST /users` → `POST /users/:id/follow` → `GET /users/:id/feed` com dois usuários e comparar o feed antes/depois do follow.
3. Ler `UserController.follow` e discutir: por que validar `targetId === followerId` no código, em vez de deixar o banco rejeitar? E por que ainda assim existe um `try/catch` para `P2002`?
4. Alterar `Follow` para incluir um campo `createdAt` já existe — desafio: adicionar um endpoint `GET /users/:id/following` que lista quem o usuário segue (usar `user.following` com `include: { following: true }`).

## Documentação do projeto

O **porquê** das decisões fica em [`docs/`](docs/README.md), separado do código:

* [`docs/adr/`](docs/adr/README.md) — registros de decisão (contexto, decisão, alternativas descartadas, consequências), do 0001 ao 0008.
* [`docs/arquitetura/c4.md`](docs/arquitetura/c4.md) — diagramas C4: contexto, containers e componentes (dois recortes no nível 3).
* [`docs/BACKLOG.md`](docs/BACKLOG.md) — o Trabalho II em incrementos, com critério de aceite por cartão.

Regra: mudou um módulo ou uma dependência externa, o diagrama muda no **mesmo commit**; decisão nova vira ADR novo (ADR aceito não se edita, se substitui).

## Discussão em sala — Aula 05

Pensando em portas e adaptadores, caso fosse criado uma porta ligando o controller ao ORM (prisma cliente) isso iria eliminar a dependência direta do prisma, deixando a possibilidade de adaptar futuramente outro ORM sem muitas alterações no restante do app, porém este é um evento raro em projetos e o prisma já possui alguma flexibilidade quanto as mudanças no banco de dados. Os ganhos da arquitetura exagonal vêm do isolamento do domínio, isolar o controller já é uma camada fora. A análise do quanto custa a um projeto deste tamanho passa pela maturidade do projeto, da verificação de partes melhores candidatas ao isolamento do dominio da aplicação, caso o porte do projeto justifique a complexidade trazida com essas alterações.





## Discussão obrigatória — Trabalho II

## Item 1
Quanto a decisão pela criação de LikeCOntroller.ts e CommentController.ts foi tomada, com base na arquitetura do projeto por módulos, aconteceu antes de implementar a parte de escrita (persistência). Mas pensando agora sobre o que foi codificado, penso que se justifica, tendo em vista que poderá haver comentário de comentário, não necessariamente ligado a um post e que comentários poderão receber likes, ou seja, o like é ligado ao comentário, não a o post diretamente. Desta forma, não quebramos o princípio da responsabilidade única.
## Item 2
Em produção, considero que o banco tenha dados que não devem ser replicados e dependendo das alterações, o dump dos dados não validaria em um novo formato de campos/tabelas, não vale o risco. Na prática prisma migrate reset nunca deve ser utilizado em produção. Os comandos possíveis em produção são como prisma migrate deploy, incremental e não destrutivo.
## Item 3
De fato, o fetch torna a navegação mais fluída, evitando o reload a cada iteração. Porém o form tem varias vantagens da tag, enquanto o fetch terá de ser controlado e validado via js no frontend.
## Item 4
A delegação de eventos consiste em ouvir eventos em um nó do DOM ancestral, que não seja feito o reload durante o carregamento ou interações e que fique mais próximo possível ao nó que queremos monitorar. No caso em tela, poderia colocar o listener para ouvir <section id="feed">.
