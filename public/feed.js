/**
 * Interações do feed sem recarregar a página.
 *
 * O ponto central é a DELEGAÇÃO DE EVENTOS: existe **um** listener, no
 * ancestral estável (`#feed`), e não um por botão. Posts e comentários
 * inseridos depois (comentário novo, scroll infinito do item 6) já nascem
 * cobertos — nada precisa ser re-amarrado no momento do append, e
 * re-renderizar um card não mata o listener.
 *
 * `submit` (e não `click`) porque cobre clique, Enter e qualquer outro
 * caminho de envio; `closest()` porque o clique cai no <svg>/<span> dentro
 * do botão, não no <form>.
 *
 * Dois tipos de interação, com garantias diferentes de propósito:
 * - curtida: OTIMISTA (pinta antes da resposta, desfaz se falhar) — o estado
 *   é binário e reversível, então errar por alguns milissegundos é barato;
 * - comentário: só aparece depois do 201 do servidor — o texto e o id vêm de
 *   lá; inventar um comentário otimista exigiria inventar id e autor.
 */
(() => {
  const feed = document.getElementById('feed');
  if (!feed) return;

  const LIKE_FORM = 'form[action^="/posts/"][action$="/like"]';
  const COMMENT_FORM = 'form[data-comment-form]';
  const COMMENT_DELETE = 'form[data-comment-delete]';

  feed.addEventListener('submit', (event) => {
    const form = event.target.closest('form');
    if (!form) return;

    if (form.matches(LIKE_FORM)) {
      event.preventDefault();
      toggleLike(form);
      return;
    }
    if (form.matches(COMMENT_FORM)) {
      event.preventDefault();
      createComment(form);
      return;
    }
    if (form.matches(COMMENT_DELETE)) {
      event.preventDefault();
      deleteComment(form);
      return;
    }
    // /follow, /logout, /posts/:id/delete: segue o fluxo normal do formulário
  });

  // ----------------------------------------------------------------- curtida

  async function toggleLike(form) {
    if (form.dataset.pending === '1') return; // guarda por formulário: o duplo clique morre aqui
    form.dataset.pending = '1';

    const button = form.querySelector('button');
    const counter = form.querySelector('[data-like-count]');
    const before = { liked: button.dataset.liked === '1', count: Number(counter.textContent) };

    paint(button, counter, !before.liked, before.count + (before.liked ? -1 : 1));
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin', // sem isso o cookie de sessão não vai e o requireAuth barra
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000), // fetch não tem timeout por padrão
      });

      // 409 = "já curtido" (corrida de duplo clique): para o usuário é sucesso
      if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`);

      const state = res.status === 409 ? null : await res.json().catch(() => null);
      if (state && typeof state.likeCount === 'number') {
        paint(button, counter, state.liked, state.likeCount); // o servidor é a verdade
      }
    } catch (err) {
      paint(button, counter, before.liked, before.count); // rollback visual
      showError(
        form,
        err.name === 'AbortError' ? 'A curtida demorou demais.' : 'Não foi possível curtir agora.',
      );
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      delete form.dataset.pending;
    }
  }

  function paint(button, counter, liked, count) {
    button.dataset.liked = liked ? '1' : '0';
    button.setAttribute('aria-pressed', String(liked)); // leitor de tela sabe que virou um toggle
    button.classList.toggle('text-rose-600', liked);
    button.classList.toggle('text-slate-500', !liked);
    const heart = button.querySelector('svg');
    if (heart) heart.setAttribute('fill', liked ? 'currentColor' : 'none');
    counter.textContent = String(count);
  }

  // --------------------------------------------------------------- comentário

  async function createComment(form) {
    if (form.dataset.pending === '1') return;
    const field = form.querySelector('input[name="content"]');
    const text = field.value.trim();
    if (!text) return;

    form.dataset.pending = '1';
    const submit = form.querySelector('button');
    submit.disabled = true;

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        // JSON porque a rota lê `req.body` do express.json/urlencoded; enviar
        // FormData mandaria multipart, que esta rota não parseia.
        body: JSON.stringify({ content: text }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const comment = await res.json();

      const article = form.closest('article');
      const list = article?.querySelector('[data-comment-list]');
      if (list) list.appendChild(renderComment(comment));

      field.value = '';
      bumpCounter(article, +1);
    } catch (err) {
      showError(
        form,
        err.name === 'AbortError' ? 'O comentário demorou demais.' : 'Não foi possível comentar agora.',
      );
    } finally {
      submit.disabled = false;
      delete form.dataset.pending;
    }
  }

  /** Monta o <li> com `textContent` — nada de innerHTML com dado de usuário. */
  function renderComment(comment) {
    const li = document.createElement('li');
    li.className = 'flex items-start gap-2 text-sm';
    li.dataset.commentId = String(comment.id);

    const p = document.createElement('p');
    p.className = 'flex-1 text-slate-700';

    const author = document.createElement('strong');
    author.className = 'text-slate-800';
    author.textContent = comment.author?.name ?? '';

    const content = document.createElement('span');
    content.dataset.commentContent = '';
    content.textContent = ` ${comment.content}`;

    p.append(author, content);
    li.appendChild(p);

    // Quem comentou pela própria sessão é o dono — pode apagar.
    const form = document.createElement('form');
    form.method = 'post';
    form.action = `/comments/${comment.id}/delete`;
    form.dataset.commentDelete = '';

    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'text-xs text-red-600 hover:underline';
    button.textContent = 'apagar';

    form.appendChild(button);
    li.appendChild(form);
    return li;
  }

  async function deleteComment(form) {
    if (form.dataset.pending === '1') return;
    form.dataset.pending = '1';

    const item = form.closest('[data-comment-id]');
    const article = form.closest('article');
    const button = form.querySelector('button');
    if (button) button.disabled = true;

    // O form aponta para `/comments/:id/delete` (fallback sem JS); o fetch usa
    // o DELETE da mesma rota, sem o sufixo.
    const url = form.action.replace(/\/delete$/, '');

    try {
      const res = await fetch(url, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      item?.remove();
      bumpCounter(article, -1);
    } catch (err) {
      if (button) button.disabled = false;
      showError(
        form,
        err.name === 'AbortError' ? 'A remoção demorou demais.' : 'Não foi possível apagar agora.',
        item ?? form,
      );
    } finally {
      delete form.dataset.pending;
    }
  }

  /** Mantém o contador do rodapé coerente com o que está na tela. */
  function bumpCounter(article, delta) {
    const counter = article?.querySelector('[data-comment-count]');
    if (!counter) return;
    const atual = Number(counter.textContent) || 0;
    counter.textContent = String(Math.max(0, atual + delta));
  }

  /** Mensagem de erro curta, dentro de `alvo` (o form, ou a linha do comentário). */
  function showError(form, message, alvo = form) {
    alvo.querySelector('[data-like-error]')?.remove();
    const note = document.createElement('p');
    note.dataset.likeError = '';
    note.className = 'text-xs text-red-600 mt-1';
    note.textContent = message;
    alvo.appendChild(note);
    setTimeout(() => note.remove(), 4000);
  }
})();
