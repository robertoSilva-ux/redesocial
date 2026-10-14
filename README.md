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
* **npm 12 bloqueia install scripts**: o `postinstall` que rodava `prisma generate` não executa sozinho. Depois de um `npm install` limpo, rode `npx prisma generate` (ou aprove com `npm install-scripts approve prisma`). O mesmo vale para o `node-gyp rebuild` do `better-sqlite3`.
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
| `GET /users/:id/feed` | posts de quem o usuário segue | filtro relacional aninhado (`author.followers.some`) |
| `POST /posts` | cria post (`{ authorId, content, tags?: string[] }`) | **1:N** (`connect`) + **N:N** (`connectOrCreate`) na mesma escrita |
| `GET /posts/:id` | post com autor e tags | `include` |
| `GET /tags/:name/posts` | posts de uma tag | N:N do outro lado |

## Estrutura

```
prisma/
├── schema.prisma   → os 4 models e as 3 relações
└── seed.ts          → dados de exemplo

src/
├── db.ts                    fábrica de PrismaClient
├── users/UserController.ts   create, get, follow, feed
├── posts/PostController.ts   create, get, listByTag
├── shared/                   erros de domínio, error handler, asyncHandler
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

## Discussão para a Aula 05

Pensando em portas e adaptadores, caso fosse criado uma porta ligando o controller ao ORM (prisma cliente) isso iria eliminar a dependência direta do prisma, deixando a possibilidade de adaptar futuramente outro ORM sem muitas alterações no restante do app, porém este é um evento raro em projetos e o prisma já possui alguma flexibilidade quanto as mudanças no banco de dados. Os ganhos da arquitetura exagonal vêm do isolamento do domínio, isolar o controller já é uma camada abaixo. A análise do quanto custa a um projeto deste tamanho passa pela maturidade do projeto, da verificação de partes melhores candidatas ao isolamento do dominio da aplicação, caso o porte do projeto justifique a complexidade trazida com essas alterações.