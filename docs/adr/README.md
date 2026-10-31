# ADRs — Architecture Decision Records

Formato: [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions),
adaptado (com uma seção de alternativas descartadas, porque é a parte que mais se reaproveita).

O nome do arquivo segue `NNNN-titulo-curto-em-kebab-case.md`, numeração sequencial que **nunca é
reutilizada** — ADR apagado deixa o número queimado.

## Índice

| # | Decisão | Status | Data |
| --- | --- | --- | --- |
| [0001](0001-modulos-por-feature.md) | Módulos por recurso, com Prisma Client injetado | Aceita | 2026-10-13 |
| [0002](0002-like-com-alvo-exclusivo.md) | Uma tabela `Like` com alvo exclusivo (post **ou** comentário) | Aceita | 2026-10-13 |
| [0003](0003-migracoes-com-passo-de-dados.md) | Migração sempre versionada, com passo de dados quando há dado existente | Aceita | 2026-10-27 |
| [0004](0004-interacoes-sem-reload.md) | Interações via `fetch` sobre formulário funcional + delegação de eventos | Aceita | 2026-10-14 |
| [0005](0005-paginacao-e-ordenacao-uniformes.md) | Paginação e ordenação com o mesmo contrato em todas as listagens | Aceita | 2026-10-13 |
| [0006](0006-testes-contra-sqlite-real.md) | Testes de integração contra SQLite real, sem mock do Prisma | Aceita | 2026-10-13 |
| [0007](0007-upload-atraves-de-imagestorage.md) | Upload atrás da porta `ImageStorage` (local × S3 pelo `.env`) | Aceita | 2026-10-14 |
| [0008](0008-better-sqlite3-pin-global.md) | `better-sqlite3` fixado no override global (prebuilds, sem script de build) | Aceita | 2026-10-31 |

## Template

```markdown
# ADR-NNNN — Título no imperativo ou como afirmação

- **Status:** Proposta | Aceita | Substituída por ADR-XXXX | Depreciada
- **Data:** AAAA-MM-DD
- **Decisores:** quem decidiu

## Contexto
Situação e forças em jogo. Restrições do enunciado, do ambiente e do código que já existe.
Sem solução aqui — só o problema e o que aperta.

## Decisão
O que foi decidido, no presente do indicativo ("a tabela X tem..."), com o detalhe suficiente
para alguém implementar sem perguntar.

## Alternativas consideradas
Cada uma com o motivo real de ter sido descartada. Sem espantalho.

## Consequências
### Positivas
### Negativas / custos
### Riscos e mitigação
```

Relação com o `README.md` da raiz: o README responde às perguntas da discussão obrigatória em
prosa (é o que o professor lê); o ADR é o registro técnico durável. Quando os dois divergirem,
o ADR é a fonte — e o README precisa ser corrigido no mesmo commit.
