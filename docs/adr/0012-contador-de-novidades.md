# ADR-0012 — Contador de novidades derivado de `createdAt`, com corte em `User.lastSeenAt`

**Status:** Aceita
**Data:** 31/10/2026
**Contexto do trabalho:** Trabalho II, atividade 10 ("notificação simples e não realtime: contador de
novas curtidas/comentários desde seu último acesso, calculado a partir de `createdAt`")

## Contexto

O enunciado pede um contador, **não** uma caixa de notificações e **não** nada em tempo real. As
decisões a tomar eram três, e nenhuma é óbvia:

1. **O que conta como novidade** — a atividade na minha rede toda, ou só a que me envolve?
2. **De onde vem o número** — contador incremental (colunas `unreadLikes`/`unreadComments` mantidas
   a cada curtida) ou derivado do banco no momento da leitura?
3. **Quando zera** — a cada requisição, ao abrir o feed, ou quando a pessoa clica no aviso?

## Decisão

**O que conta.** Só o que me envolve, e só de terceiros:

| Evento | Conta? |
| --- | --- |
| curtida de outra pessoa em post meu | sim |
| curtida de outra pessoa em comentário meu | sim |
| comentário de outra pessoa em post meu | sim |
| curtida/comentário meus nos meus posts | **não** (é a minha própria ação) |
| curtida em post de quem eu sigo | **não** (não é "minha" notificação) |

**De onde vem.** Derivado: três `count()` com `createdAt > User.lastSeenAt`, num método só
(`NotificationController.countSince`). Nada de contador materializado — nenhuma coluna de "não lido"
para manter, e o número nunca diverge do banco, porque é lido dele.

**Quando zera.** Abrir o **feed** (`GET /`) marca `lastSeenAt = agora`, *depois* de ler o contador:
o selo aparece naquela carga e some na seguinte. Abrir a página de um post **não** zera — senão ler
um post consumiria o aviso antes de a pessoa voltar ao feed.

**Primeiro acesso (`lastSeenAt` nulo) devolve zero**, não o histórico inteiro da conta. Sem um corte
anterior, "novo" não significa nada; e um número gigante na primeira tela informa menos que um zero.

## Alternativas descartadas

* **Contador materializado** (`User.unreadLikes`, `User.unreadComments`). Número O(1) para ler, mas
  cada curtida passa a fazer uma escrita extra na linha do autor (contenção em post popular), e
  qualquer correção de dados exige recalcular tudo. O `count()` com índice resolve por menos.
* **Tabela de eventos com marca de "lido" por item.** Permite lista de notificações e "marcar como
  lida" por linha — é o que um sistema real faria —, mas é outro modelo de dados e o enunciado pede
  um contador.
* **WebSocket / SSE.** O enunciado diz explicitamente "não realtime".
* **Zerar a cada requisição autenticada.** O contador nunca apareceria: qualquer `GET` (inclusive o
  do próprio selo) consumiria a novidade antes de a tela ser lida.
* **Contar tudo desde `User.createdAt` no primeiro acesso.** Um usuário antigo com histórico grande
  veria "247 novidades" que já conhece.

## Consequências

**Positivas.** Zero estado extra no schema além de uma coluna de data; o número é sempre coerente com
o banco; a regra do que conta está num método só, fácil de testar (e está: 8 testes cobrindo os
casos da tabela acima). Se um dia a "notificação" virar lista de verdade, os mesmos três `count()`
viram três `findMany()`.

**Negativas — e são reais.**

1. **Três consultas por carga de página** (duas no `count` de curtidas, uma de comentários). Barato
   com `createdAt` indexado e o volume do trabalho, mas é trabalho repetido a cada render.
2. **O reset é agressivo.** Quem abre o feed "perde" o aviso, mesmo sem ter lido o conteúdo. A
   mitigação é a página do post não zerar, mas o comportamento é o de "último acesso", não o de
   "última leitura".
3. **O escopo é estreito:** curtida em post de quem eu sigo não conta. É defensável ("minhas"
   notificações), mas quem esperar um feed de atividade vai achar o contador baixo.
4. **`lastSeenAt` não tem índice** e não precisa: é sempre lido por `id`. O que precisa de índice é
   `createdAt` das tabelas de origem — que já existe.
5. **Só o `GET /` (HTML) marca o acesso.** Um cliente que use só a API nunca zera o contador; o selo
   é um recurso da interface, não da API.
