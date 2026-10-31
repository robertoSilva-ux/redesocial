# ADR-0008 — Fixar `better-sqlite3` no override global (prebuilds, sem script de build)

- **Status:** Aceita
- **Data:** 2026-10-31
- **Decisores:** Roberto (autor do projeto)

## Contexto

`@prisma/adapter-better-sqlite3@7.10.0` declara `better-sqlite3: ^12.6.0`; o projeto depende de
`better-sqlite3@^13.0.3` diretamente. O npm resolvia **duas** cópias: a 13.0.3 na raiz e uma
aninhada `12.11.1` dentro do adapter. A cópia aninhada vinha com binário nativo de ABI antiga e
quebrava no Node 24 (ABI 137) com `Module did not self-register` — **69 de 74 testes falhando**, com
uma mensagem que parece bug de aplicação.

O override anterior existia, mas mirava só o adapter:

```json
"overrides": { "@prisma/adapter-better-sqlite3": { "better-sqlite3": "^13.0.3" } }
```

Ele não pegava porque o `package-lock.json` já tinha a entrada aninhada fixada, e o npm preserva o
que está no lock: `npm install` **re-adicionava** a 12.11.1 (verificado com `--dry-run`). O conserto
manual era apagar `node_modules/@prisma/adapter-better-sqlite3/node_modules/better-sqlite3` — que
voltava na instalação seguinte.

## Decisão

Override **global** em `package.json` e lock regenerado:

```json
"overrides": { "better-sqlite3": "^13.0.3" }
```

Uma única cópia hoisted na raiz; o adapter passa a resolver `13.0.3` (mostrado como `deduped` em
`npm ls`), apesar do `^12.6.0` que ele declara.

## Alternativas consideradas

- **Manter a 12.11.1 e compilar no install** (`npm approve-scripts better-sqlite3` + `node-gyp`).
  Funcionaria, mas cria dependência de toolchain de compilação em toda máquina e de uma aprovação
  de script que é configuração local — um clone novo continuaria quebrado por padrão.
- **Baixar o `better-sqlite3` do projeto para `^12`.** Resolveria a cópia dupla, mas o motivo da
  falha é o binário da 12.11.1, não a versão da 13 — e o projeto perderia a versão que roda hoje.
- **`npm install --force` em cada ambiente.** Não muda a resolução da cópia aninhada; só esconde o
  conflito.
- **Vendorizar o binário / commitar `node_modules`.** Elimina o problema e o repositório junto.

## Consequências

### Positivas

- `npm ci` a partir de árvore limpa instala e a suíte passa **sem aprovar script nenhum**: a 13.0.3
  publica `prebuilds/` no próprio tarball (`linux-x64`, `linux-arm64`, `darwin-*`), então o
  `node-gyp rebuild` bloqueado pelo npm deixa de importar.
- `npm ls better-sqlite3` fica limpo (uma cópia, sem `invalid`), e `npm install --dry-run` não
  propõe mais nenhum `add`.
- Verificado: `npm ci && npm test` → **74/74** na árvore real e numa cópia isolada.

### Negativas / custos

- **Divergência declarada:** o adapter pede `^12.6.0` e roda com `13.0.3`. A compatibilidade é
  empírica (a suíte exercita o adapter contra SQLite real), não contratual.
- O override só vale enquanto o lock estiver no repositório com ele: quem apagar o
  `package-lock.json` e regerar sem o override volta ao estado quebrado.
- Fixar uma dependência transitiva é dívida: a cada atualização do Prisma, o override precisa ser
  reexaminado em vez de herdado sem pensar.

### Riscos e mitigação

- **Uma versão futura do adapter usar API que mudou na 13.** Mitigação: ao subir `@prisma/client` /
  `@prisma/adapter-better-sqlite3`, rodar a suíte antes de commitar; se quebrar, reavaliar o pin com
  este ADR em mãos (e substituí-lo, não editá-lo).
- **Volta da cópia aninhada.** Sintoma: suíte inteira vermelha com `Module did not self-register`.
  Diagnóstico em um comando: `npm ls better-sqlite3` (duas cópias = regressão do override).

## Referências

- `package.json` (bloco `overrides`), `package-lock.json` (entrada única `node_modules/better-sqlite3`)
- `README.md` → "Notas de ambiente"
- `src/db.ts` e `test/helpers/testDb.ts` (quem instancia o adapter)
- Skill `node-typescript-project-health` (Prisma 7 + SQLite)
