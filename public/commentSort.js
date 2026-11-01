/**
 * Ordenação de comentários na página do post (item 9 do Trabalho II).
 *
 * O backend já suporta `?sort=likes` (mais curtidos primeiro, com desempate
 * estável) e `?sort=createdAt` (ordem da conversa). Aqui só trocamos a lista
 * sem recarregar:
 *
 * 1. o clique no link de ordenação é interceptado;
 * 2. `fetch` pede a MESMA rota da listagem, com `Accept: text/html` — o
 *    servidor responde o fragmento com o partial do comentário (ADR-0010), o
 *    mesmo markup que a página já renderizou;
 * 3. o `<ul data-comment-list>` é substituído e os links trocam de estado.
 *
 * Sem JS nada disso roda: os links têm `href` de verdade e a página recarrega
 * com `?sort=` (ADR-0004). Por isso o estado ativo vem do servidor
 * (`data-comment-sort` no `<ul>`), não do que o clique pediu.
 */
(() => {
  const lista = document.querySelector('[data-comment-list]');
  const barra = document.querySelector('[data-comment-sort-toggle]');
  if (!lista || !barra) return;

  const ATIVO = 'bg-slate-800 text-white';
  const INATIVO = 'text-slate-600 hover:bg-slate-100';

  const url = new URL(window.location.href);

  barra.addEventListener('click', async (event) => {
    const link = event.target.closest('[data-comment-sort]');
    if (!link) return;

    event.preventDefault();
    const escolha = link.dataset.commentSort;
    if (!escolha || escolha === lista.dataset.commentSort) return;

    link.setAttribute('aria-busy', 'true');

    try {
      // O `href` do link é `?sort=...` — resolve para a PÁGINA, não para a
      // listagem. O alvo do fetch é a rota de comentários do post, montada a
      // partir do caminho atual (`/posts/16` → `/posts/16/comments`). O
      // seletor de cliente é o header `Accept` (`src/shared/http.ts`).
      const caminho = window.location.pathname.replace(/\/$/, '');
      const alvo = new URL(`${caminho}/comments`, window.location.origin);
      alvo.searchParams.set('sort', escolha);

      const res = await fetch(alvo, {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await res.text();
      // Guarda contra alvo errado: se vier página inteira, injetar isso dentro
      // do `<ul>` duplicaria a tela (foi o primeiro defeito deste arquivo).
      if (/<html[\s>]/i.test(html)) {
        throw new Error('resposta não é um fragmento');
      }

      lista.innerHTML = html;
      lista.dataset.commentSort = escolha;
      pintar(escolha);

      // A URL passa a refletir a ordenação visível — recarregar mantém o estado,
      // e o link continua compartilhável.
      url.searchParams.set('sort', escolha);
      window.history.replaceState({}, '', url);
    } catch (err) {
      // Não mexe na lista: se a busca falhou, o que está na tela continua válido.
      mostrarErro(
        err.name === 'AbortError'
          ? 'A ordenação demorou demais para responder.'
          : 'Não foi possível reordenar os comentários.',
      );
    } finally {
      link.removeAttribute('aria-busy');
    }
  });

  function pintar(escolha) {
    for (const link of barra.querySelectorAll('[data-comment-sort]')) {
      const ativo = link.dataset.commentSort === escolha;
      link.classList.remove(...ATIVO.split(' '), ...INATIVO.split(' '));
      link.classList.add(...(ativo ? ATIVO : INATIVO).split(' '));
      if (ativo) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  }

  function mostrarErro(mensagem) {
    document.querySelector('[data-comment-sort-error]')?.remove();
    const aviso = document.createElement('p');
    aviso.dataset.commentSortError = '';
    aviso.className = 'text-xs text-red-600';
    aviso.textContent = mensagem;
    barra.after(aviso);
    setTimeout(() => aviso.remove(), 4000);
  }
})();
