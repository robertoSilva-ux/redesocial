# ADR-0004 — Interações via `fetch` sobre um formulário que já funciona

- **Status:** Aceita
- **Data:** 2026-10-14 (curtida em post; a mesma mecânica vale para comentários e carrossel)
- **Decisores:** Roberto (autor do projeto)

## Contexto

O feed nasceu inteiramente server-rendered: cada ação (postar, seguir, apagar) é um `<form>` que recarrega a página. O Trabalho II exige que curtir, comentar e carregar mais posts aconteçam **sem recarregar** — verificável no DevTools, onde só devem aparecer requisições `fetch`.

Ao mesmo tempo, esse mesmo feed recebe posts inseridos depois do carregamento (scroll infinito, item 6). Um `addEventListener` por botão, amarrado no `DOMContentLoaded`, não alcança nós que ainda não existem.

## Decisão

**Progressive enhancement com o formulário como base:**

- cada interação continua sendo um `<form method="post">` funcional; sem JavaScript, o `POST` roda e o servidor responde com `redirect` para o `Referer` (volta para onde o usuário estava);
- `public/feed.js` intercepta o `submit` por **delegação de eventos**: um único listener em `#feed` (ancestral estável), usando `event.target.closest(...)` para achar o formulário;
- o cliente sinaliza o que quer com `Accept: application/json`; o servidor responde JSON ou redirect conforme `wantsJson(req)` (`src/shared/http.ts`). Uma rota, dois contratos;
- a resposta JSON é a **verdade** (`{ liked, likeCount }` lidos do banco), e o cliente pinta o estado otimista antes da resposta e faz *rollback* visual se o `fetch` falhar;
- guarda de duplo clique por formulário (`dataset.pending`), `AbortSignal.timeout(5000)` e tratamento de erro visível (`[data-like-error]`).

## Alternativas consideradas

- **Só formulário.** Simples, mas é exatamente o comportamento que o trabalho pede para eliminar.
- **Só `fetch`, sem formulário.** O HTML perde a semântica de formulário (Enter, validação nativa, acessibilidade de submit) e a ação morre sem JS. O formulário custa uma tag.
- **Framework de front (React/Vue).** Fora do escopo: o enunciado restringe a JavaScript puro até a Aula 10, e a hidratação traria um build step que o projeto hoje não tem.
- **Listener por botão amarrado no `load`.** Funcionaria hoje e quebraria no item 6, quando os cards novos chegarem por `fetch`.

## Consequências

### Positivas

- A aplicação funciona sem JavaScript; com JavaScript, nenhuma navegação de página.
- Um listener cobre também os nós que o scroll infinito inserir — a atividade 6 não exige re-amarrar nada, nem depois de re-renderizar um card.
- O estado do botão fica no DOM (`data-liked`, `aria-pressed`), o que dá suporte a leitor de tela e sobrevive a re-render.

### Negativas / custos

- **Dois contratos na mesma rota** (JSON e redirect): toda rota de interação precisa testar os dois caminhos, e um `Accept` inesperado cai no redirect silenciosamente.
- O estado otimista duplica a verdade por alguns milissegundos; se o servidor discordar, a UI pisca (mitigado pelo rollback, não eliminado).
- O cliente precisa reimplementar o que o navegador dava de graça: estado de carregando, erro de rede, duplo envio.
- Lógica de UI em JavaScript sem tipos (`public/feed.js` não passa pelo `tsc`), sem teste automatizado — a verificação é manual no DevTools.

### Riscos e mitigação

- **Cliente e servidor divergirem no formato** (o JS esperar `likeCount` e a rota devolver outro nome). Mitigação: o teste de integração da rota fixa o contrato JSON; o `feed.js` só consome o que o teste garante.
- **`credentials` esquecido no `fetch`** → o cookie de sessão não vai e o `requireAuth` devolve redirect de login, que o cliente interpretaria como sucesso. Mitigação: `credentials:
  'same-origin'` explícito e o `!res.ok` tratado antes de qualquer pintura.

## Referências

- `public/feed.js`, `src/views/feed.ejs`
- `src/likes/likeRoutes.ts`, `src/shared/http.ts` (`wantsJson`)
- `test/integration/likes.routes.test.ts`
- `README.md` → "Discussão obrigatória — Trabalho II", itens 3 e 4
