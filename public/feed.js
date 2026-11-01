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

  // Serve curtida de POST e de COMENTÁRIO: as duas rotas terminam em `/like` e
  // devolvem o mesmo `{ liked, likeCount }`, então o handler é um só.
  const LIKE_FORM = 'form[action$="/like"]';
  const COMMENT_FORM = 'form[data-comment-form]';
  const COMMENT_DELETE = 'form[data-comment-delete]';
  const COMMENT_EDIT = 'form[data-comment-edit-form]';

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
    if (form.matches(COMMENT_EDIT)) {
      event.preventDefault();
      updateComment(form);
      return;
    }
    // /follow, /logout, /posts/:id/delete: segue o fluxo normal do formulário
  });

  // Clique delegado: só os botões de edição de comentário (o resto é submit).
  feed.addEventListener('click', (event) => {
    const abrir = event.target.closest('[data-comment-edit]');
    if (abrir) {
      abrirEdicao(abrir.closest('[data-comment-id]'));
      return;
    }
    const cancelar = event.target.closest('[data-comment-edit-cancel]');
    if (cancelar) {
      fecharEdicao(cancelar.closest('[data-comment-id]'));
    }
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
    li.className = 'flex flex-wrap items-start gap-2 text-sm';
    li.dataset.commentId = String(comment.id);

    const p = document.createElement('p');
    p.className = 'flex-1 text-slate-700';

    const author = document.createElement('strong');
    // O espaço entre autor e texto é CSS (`mr-1`), não um `' '` dentro do
    // texto: assim editar o comentário, que reescreve o `textContent`, não
    // engole a separação (era exatamente o que acontecia antes).
    author.className = 'text-slate-800 mr-1';
    author.textContent = comment.author?.name ?? '';

    const content = document.createElement('span');
    content.dataset.commentContent = '';
    content.textContent = comment.content;

    p.append(author, content);
    li.appendChild(p);
    li.appendChild(buildLikeForm(comment));

    // Quem comentou pela própria sessão é o dono — pode editar e apagar. O
    // markup tem de ser igual ao do partial `comment.ejs`, senão o comentário
    // recém-criado seria um cidadão de segunda classe (sem edição) até a
    // próxima recarga.
    const acoes = document.createElement('div');
    acoes.className = 'flex items-center gap-2';

    const editar = document.createElement('button');
    editar.type = 'button';
    editar.dataset.commentEdit = '';
    editar.className = 'text-xs text-slate-500 hover:underline';
    editar.textContent = 'editar';

    const apagarForm = document.createElement('form');
    apagarForm.method = 'post';
    apagarForm.action = `/comments/${comment.id}/delete`;
    apagarForm.dataset.commentDelete = '';

    const apagar = document.createElement('button');
    apagar.type = 'submit';
    apagar.className = 'text-xs text-red-600 hover:underline';
    apagar.textContent = 'apagar';

    apagarForm.appendChild(apagar);
    acoes.append(editar, apagarForm);
    li.appendChild(acoes);

    const edicao = document.createElement('form');
    edicao.method = 'post';
    edicao.action = `/comments/${comment.id}/edit`;
    edicao.dataset.commentEditForm = '';
    edicao.className = 'hidden basis-full flex gap-2 mt-1';

    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'content';
    input.required = true;
    input.maxLength = 2000;
    input.value = comment.content;
    input.className = 'flex-1 border rounded px-2 py-1 text-sm';

    const salvar = document.createElement('button');
    salvar.type = 'submit';
    salvar.className = 'text-xs bg-slate-800 text-white rounded px-2 py-1';
    salvar.textContent = 'salvar';

    const cancelar = document.createElement('button');
    cancelar.type = 'button';
    cancelar.dataset.commentEditCancel = '';
    cancelar.className = 'text-xs text-slate-500 hover:underline';
    cancelar.textContent = 'cancelar';

    edicao.append(input, salvar, cancelar);
    li.appendChild(edicao);

    return li;
  }

  /**
   * Monta o mesmo botão de curtida que o partial `views/partials/comment.ejs`
   * renderiza — comentário novo nasce com o botão já funcional, porque a
   * delegação em `#feed` cobre qualquer `form[action$="/like"]`.
   */
  function buildLikeForm(comment) {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = `/comments/${comment.id}/like`;
    form.dataset.commentLike = '';

    const button = document.createElement('button');
    button.type = 'submit';
    button.title = 'Curtir comentário';
    button.dataset.liked = '0';
    button.setAttribute('aria-pressed', 'false');
    button.className = 'flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'w-4 h-4');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute(
      'd',
      'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z',
    );
    svg.appendChild(path);

    const counter = document.createElement('span');
    counter.dataset.likeCount = '';
    counter.textContent = String(comment._count?.likes ?? 0);

    button.append(svg, counter);
    form.appendChild(button);
    return form;
  }

  // ---------------------------------------------------------- editar comentário

  function abrirEdicao(li) {
    if (!li) return;
    li.querySelector('[data-comment-content]')?.classList.add('hidden');
    const form = li.querySelector('[data-comment-edit-form]');
    if (!form) return;
    form.classList.remove('hidden');
    const input = form.querySelector('input[name="content"]');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function fecharEdicao(li) {
    if (!li) return;
    li.querySelector('[data-comment-content]')?.classList.remove('hidden');
    li.querySelector('[data-comment-edit-form]')?.classList.add('hidden');
  }

  async function updateComment(form) {
    if (form.dataset.pending === '1') return;
    const li = form.closest('[data-comment-id]');
    const input = form.querySelector('input[name="content"]');
    const texto = input.value.trim();
    if (!texto) return;

    form.dataset.pending = '1';
    const salvar = form.querySelector('button[type="submit"]');
    if (salvar) salvar.disabled = true;

    // O form aponta para `/comments/:id/edit` (fallback sem JS); o fetch usa o
    // PATCH do mesmo recurso, sem o sufixo.
    const url = form.action.replace(/\/edit$/, '');

    try {
      const res = await fetch(url, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: texto }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const comment = await res.json();

      const span = li.querySelector('[data-comment-content]');
      if (span) span.textContent = comment.content;
      marcarEditado(li);
      fecharEdicao(li);
    } catch (err) {
      showError(
        form,
        err.name === 'AbortError' ? 'A edição demorou demais.' : 'Não foi possível salvar a edição.',
      );
    } finally {
      if (salvar) salvar.disabled = false;
      delete form.dataset.pending;
    }
  }

  function marcarEditado(li) {
    if (!li || li.querySelector('[data-comment-edited]')) return;
    const marca = document.createElement('span');
    marca.dataset.commentEdited = '';
    marca.className = 'text-xs text-slate-400';
    marca.textContent = ' (editado)';
    li.querySelector('[data-comment-content]')?.after(marca);
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
  // ------------------------------------------------------- scroll infinito
  /*
   * O servidor renderiza a primeira página e deixa o cursor no sentinela
   * (`#feed-sentinel[data-next-cursor]`, ADR-0010). Quando o sentinela chega
   * perto da viewport, pedimos o próximo lote — que é HTML pronto — e
   * inserimos antes dele. O cursor seguinte vem no header `X-Next-Cursor`;
   * ausente = fim da lista.
   *
   * `IntersectionObserver` em vez de ouvir `scroll`: não precisa calcular
   * posição, funciona com qualquer altura de conteúdo e não roda a cada pixel
   * rolado.
   *
   * Os cards inseridos NÃO precisam de listener novo: a delegação em `#feed`
   * já cobre curtir, comentar, apagar e curtir comentário.
   */
  const sentinela = document.getElementById('feed-sentinel');

  if (sentinela) {
    let carregando = false;
    let acabou = !sentinela.dataset.nextCursor;
    const fim = document.querySelector('[data-feed-end]');

    const observer = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((entrada) => entrada.isIntersecting)) return;
        if (carregando || acabou) return;
        carregarMais();
      },
      { rootMargin: '200px' }, // começa a buscar antes de chegar no fim
    );

    observer.observe(sentinela);
    if (acabou) finalizar();

    async function carregarMais() {
      carregando = true;
      sentinela.dataset.carregando = '1';

      try {
        const url = `/feed/more?cursor=${encodeURIComponent(sentinela.dataset.nextCursor)}`;
        const res = await fetch(url, {
          credentials: 'same-origin',
          headers: { Accept: 'text/html' },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const html = await res.text();
        // Conteúdo renderizado no servidor; `insertAdjacentHTML` aceita a
        // string, e o EJS já escapou o que veio de usuário (ADR-0010).
        sentinela.insertAdjacentHTML('beforebegin', html);

        const proximo = res.headers.get('X-Next-Cursor');
        if (proximo) {
          sentinela.dataset.nextCursor = proximo;
        } else {
          acabou = true;
          finalizar();
        }
      } catch (err) {
        // Não marca `acabou`: o próximo scroll tenta de novo.
        mostrarAvisoFeed(
          err.name === 'AbortError' ? 'O feed demorou demais para responder.' : 'Não foi possível carregar mais posts.',
        );
      } finally {
        carregando = false;
        delete sentinela.dataset.carregando;
      }
    }

    function finalizar() {
      observer.disconnect();
      sentinela.remove();
      if (fim) fim.classList.remove('hidden');
    }
  }

  function mostrarAvisoFeed(mensagem) {
    const anterior = document.querySelector('[data-feed-error]');
    if (anterior) anterior.remove();

    const aviso = document.createElement('p');
    aviso.dataset.feedError = '';
    aviso.className = 'text-center text-sm text-red-600 py-2';
    aviso.textContent = mensagem;
    sentinela.insertAdjacentElement('beforebegin', aviso);
    setTimeout(() => aviso.remove(), 4000);
  }

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
