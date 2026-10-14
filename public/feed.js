/**
 * Interações do feed sem recarregar a página.
 *
 * O ponto central é a DELEGAÇÃO DE EVENTOS: existe **um** listener, no
 * ancestral estável (`#feed`), e não um por botão. Posts inseridos depois
 * (scroll infinito, item 6) já nascem cobertos — nada precisa ser
 * re-amarrado no momento do append, e re-renderizar um card não mata o
 * listener.
 *
 * `submit` (e não `click`) porque cobre clique, Enter e qualquer outro
 * caminho de envio; `closest()` porque o clique cai no <svg>/<span> dentro
 * do botão, não no <form>.
 *
 * A curtida é OTIMISTA: pinta na hora e desfaz se o servidor recusar
 * (item 8 — rollback visual).
 */
(() => {
  const feed = document.getElementById('feed');
  if (!feed) return;

  const LIKE_FORM = 'form[action^="/posts/"][action$="/like"]';

  feed.addEventListener('submit', (event) => {
    const form = event.target.closest(LIKE_FORM);
    if (!form) return; // /follow, /logout, /delete: deixa o formulário seguir o fluxo normal
    event.preventDefault();
    toggleLike(form);
  });

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

  function showError(form, message) {
    form.querySelector('[data-like-error]')?.remove();
    const note = document.createElement('p');
    note.dataset.likeError = '';
    note.className = 'text-xs text-red-600 mt-1';
    note.textContent = message;
    form.appendChild(note);
    setTimeout(() => note.remove(), 4000);
  }
})();
