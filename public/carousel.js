/**
 * Carrossel de fotos do post (item 5 do Trabalho II) — JavaScript puro.
 *
 * Delegação de eventos de novo: um listener por carrossel, no próprio nó
 * `[data-carousel]`, em vez de um por seta/indicador. Como o carrossel existe
 * desde o HTML renderizado no servidor (não é inserido depois por `fetch`),
 * aqui o listener pode ser amarrado na inicialização — diferente do feed, que
 * precisa cobrir posts que ainda não existem.
 *
 * Estado no DOM (`data-index`), não em closure: qualquer coisa que re-renderize
 * o carrossel pode ler o índice atual sem precisar falar com este arquivo.
 */
(() => {
  const carrosseis = document.querySelectorAll('[data-carousel]');
  if (carrosseis.length === 0) return;

  carrosseis.forEach((carrossel) => {
    const track = carrossel.querySelector('[data-carousel-track]');
    const slides = Array.from(carrossel.querySelectorAll('[data-carousel-slide]'));
    const dots = Array.from(carrossel.querySelectorAll('[data-carousel-dot]'));
    const live = carrossel.querySelector('[data-carousel-live]');
    if (!track || slides.length < 2) return;

    const total = slides.length;

    function atual() {
      return Number(carrossel.dataset.index) || 0;
    }

    function irPara(indice) {
      // Navegação circular: da última para a primeira e vice-versa.
      const alvo = ((indice % total) + total) % total;
      carrossel.dataset.index = String(alvo);
      track.style.transform = `translateX(-${alvo * 100}%)`;

      slides.forEach((slide, i) => slide.setAttribute('aria-hidden', String(i !== alvo)));
      dots.forEach((dot, i) => {
        dot.classList.toggle('bg-white', i === alvo);
        dot.classList.toggle('bg-white/60', i !== alvo);
        if (i === alvo) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
      if (live) live.textContent = `Foto ${alvo + 1} de ${total}`;
    }

    carrossel.addEventListener('click', (event) => {
      const alvo = event.target.closest('button');
      if (!alvo) return;

      if (alvo.hasAttribute('data-carousel-prev')) irPara(atual() - 1);
      else if (alvo.hasAttribute('data-carousel-next')) irPara(atual() + 1);
      else if (alvo.hasAttribute('data-carousel-dot')) irPara(Number(alvo.dataset.carouselDot));
    });

    carrossel.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        irPara(atual() - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        irPara(atual() + 1);
      }
    });

    irPara(0); // normaliza o estado inicial (dots, aria, transform)
  });
})();
