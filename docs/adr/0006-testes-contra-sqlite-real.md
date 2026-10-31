# ADR-0006 — Testes de integração contra SQLite real, sem mock do Prisma

- **Status:** Aceita
- **Data:** 2026-10-13
- **Decisores:** Roberto (autor do projeto); decisão herdada do material da Aula 04 e mantida aqui

## Contexto

O projeto tem três camadas de teste (`test/integration/`, `test/unit/`) com Vitest + Supertest. O Prisma é usado direto pelos Controllers, sem repositório e sem porta — ou seja, **não existe costura de injeção** para colocar um dublê no lugar do banco sem inventar uma arquitetura que o enunciado adia para o Trabalho III.

As garantias que o trabalho precisa provar são justamente as que só existem no banco: unicidade (`@@unique`), `CHECK` escrito à mão na migration, `onDelete: Cascade`, e a corrida de duplo clique que gera `P2002`.

## Decisão

Os testes de integração sobem o app real (`supertest`) contra um banco SQLite real (`test.db`),
com as migrations aplicadas de verdade:

- `test/globalSetup.ts` apaga o `test.db`, roda `prisma migrate deploy` com `DATABASE_URL`
  apontando para ele, e a suíte inteira usa esse arquivo;
- `resetDatabase()` limpa as tabelas entre testes **na ordem de dependência das FKs**
  (`Like → Comment → Image → UserProfile → Follow → Post → Tag → User`);
- não há mock do `PrismaClient`; `FakeImageStorage` é o único dublê, e ele substitui uma **porta** (`ImageStorage`), que existe de propósito.

## Alternativas consideradas

- **Mock do Prisma Client.** Um mock de `prisma.like.create` não conhece `@@unique`, não lança `P2002`, não aplica `CHECK` e não faz `Cascade`. Os testes passariam com um schema quebrado — o pior tipo de verde.
- **SQLite em memória (`:memory:`).** Cada conexão tem o seu banco, o que atrapalha quando o app e o teste abrem conexões distintas; e o `test.db` em arquivo já elimina o efeito "passa em memória, quebra no arquivo" (WAL, locks, tipos). Arquivo também permite abrir o banco no `sqlite3` para
  investigar uma falha.
- **Postgres em container.** É o destino de um sistema real e pegaria diferenças de dialeto, mas adiciona infraestrutura obrigatória para rodar uma aula, e o projeto é SQLite por decisão do material.

## Consequências

### Positivas

- O schema é exercitado de verdade: `P2002`, `CHECK`, `Cascade` e `SetNull` têm teste próprio
  (`test/integration/schema.test.ts`).
- O mesmo caminho de migration do deploy (`migrate deploy`) roda em todo `npm test`.
- Rodar a suíte inteira é um comando, sem preparar ambiente além do `npm install`.

### Negativas / custos

- Suíte mais lenta (≈16 s para 74 testes) e estado compartilhado: um teste que esquece o
  `resetDatabase` contamina o seguinte.
- Exige o módulo nativo `better-sqlite3` compilado para o Node em uso. **Esse é o ponto que já quebrou a suíte**: uma cópia aninhada `better-sqlite3@12.11.1` (binário incompatível com Node 24,
  ABI 137) fazia os 69 testes de integração falharem com `Module did not self-register`.
- Teste de integração não localiza a falha com precisão: um erro de regra de negócio e um erro de rota aparecem como "status 500".

### Riscos e mitigação

- **Ambiente reprovar o código.** Um `better-sqlite3` quebrado derruba 69 de 74 testes com um erro que parece bug de aplicação. Mitigação: `README.md` → "Notas de ambiente"; a mensagem
  `Module did not self-register` é ambiente, não código.
- **Cobertura de unidade baixa** para lógica que poderia ser testada sem banco (paginação, `buildOrderBy`). Mitigação: `test/unit/` cobre o que não depende de I/O (`passwords`, `localStorage`).

## Referências

- `test/globalSetup.ts`, `test/helpers/testDb.ts`, `vitest.config.ts`
- `test/integration/`, `test/unit/`
- `README.md` → "Testes: por que usam SQLite real, não mocks" e "Notas de ambiente"
