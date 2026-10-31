# ADR-0001 — Módulos por recurso, com Prisma Client injetado

- **Status:** Aceita
- **Data:** 2026-10-13 (estrutura herdada do material da Aula 04; reafirmada em 2026-10-14 ao
  nascer o módulo `likes/`)
- **Decisores:** Roberto (autor do projeto)

## Contexto

O projeto veio da Aula 04 já organizado por recurso (`users/`, `posts/`), e a Aula 05 acrescentou
`auth/` e `uploads/`. O Trabalho II traz curtidas, comentários, curtidas em comentários, múltiplas fotos e scroll infinito — e a discussão obrigatória (item 1) pergunta explicitamente se curtidas e comentários entram como módulos novos ou como métodos dentro do `PostController`.

As forças em jogo:

- o Controller chama o Prisma Client direto; arquitetura hexagonal e Ports & Adapters estão **fora do escopo** deste trabalho (o enunciado as adia);
- comentário pode ser resposta de outro comentário e pode receber curtida — ou seja, o "alvo" de uma curtida nem sempre é um `Post`;
- o trabalho é entregue em incrementos, cada um com teste próprio.

## Decisão

Cada recurso é um módulo em `src/<recurso>/`, com um `Controller` que recebe o `PrismaClient` no
construtor. Quando o recurso tem caminho de escrita que depende de sessão, ele ganha também o seu arquivo de rotas (`likes/likeRoutes.ts`), registrado em `server.ts`.

Regras que valem entre módulos:

- um módulo **não importa o Controller de outro**; a colaboração acontece pelo `PrismaClient` compartilhado;
- o que um módulo expõe é o seu Controller (ou uma rota), nunca os seus detalhes internos;
- `webRoutes.ts` (HTML/EJS) e `routes.ts` (JSON de leitura em `/api`) são as bordas; o módulo não conhece EJS nem o formato da resposta.

## Alternativas consideradas

- **Métodos dentro de `PostController`.** Menos arquivos e menos boilerplate, mas o Controller passa a responder por três recursos, e a curtida em comentário não tem relação com `Post` — a fronteira de módulo sumiria justamente no ponto em que o domínio já não é mais "post".
- **Camadas (`controllers/`, `services/`, `repositories/`).** É o contraponto discutido na Aula 03 (*package by layer* × *package by feature*): em camadas, cada feature nova espalha arquivos por quatro diretórios, e o teste de uma feature deixa de ter um lugar óbvio.
- **Hexagonal / Ports & Adapters.** Daria testabilidade sem banco e isolaria o Prisma, mas está explicitamente fora do escopo do Trabalho II e é o objetivo declarado do Trabalho III.

## Consequências

### Positivas

- Adicionar um recurso novo não toca os existentes: `likes/` nasceu com um commit, sem editar `posts/`.
- O teste de cada módulo tem um vizinho óbvio (`test/integration/likes.routes.test.ts`).
- A borda HTTP é fina: o mesmo Controller serve o formulário sem JavaScript e o cliente `fetch`.

### Negativas / custos

- Mais arquivos e mais boilerplate de rotas do que uma classe única com cinco métodos.
- Sem porta de persistência, todo módulo depende do Prisma e do schema: uma mudança de model propaga para todos os módulos que a tocam.
- O `PrismaClient` compartilhado é acoplamento técnico entre módulos — aceitável aqui, mas é a costura que a arquitetura hexagonal viria cortar.

### Riscos e mitigação

- **Dependência cruzada por detalhe interno** (ex.: `likes/` importar um helper privado de `posts/`). Mitigação: instanciar o Controller alheio é proibido por convenção; se um módulo precisa de dado de outro, consulta pelo Prisma.
- **Divergência de regra entre módulos** (a mesma validação escrita duas vezes). Mitigação: o que é comum a todos vai para `shared/` (`errors.ts`, `http.ts`, `pagination.ts`).

## Referências

- `src/server.ts` (composition root das rotas), `src/likes/likeRoutes.ts`, `src/comments/`
- `README.md` → "Discussão obrigatória — Trabalho II", item 1
- Material: `tads-webii-2026-2/Aula03/aula03.md` (modularidade), `Aula05/aula05.md`
