/*
  SAUCHA · CARRUSEL DE PRODUCTOS (sections/productos-saucha.liquid, disposición «Carrusel»)
  ---------------------------------------------------------------
  El desplazamiento es el scroll nativo del navegador (táctil, trackpad, teclado, lectores de pantalla).
  Aquí solo se añade:
    · flechas que avanzan una «página» y se ocultan en los extremos
    · arrastre con ratón (sin disparar el clic de la tarjeta si se ha arrastrado)
    · barra de progreso
    · flechas centradas en la altura de la foto, sea cual sea la proporción
*/
(() => {
  if (customElements.get('saucha-carousel')) return;

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  const DRAG_THRESHOLD = 6;

  class SauchaCarousel extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('[data-carousel-track]');
      if (!this.track) return;

      this.prev = this.querySelector('[data-carousel-prev]');
      this.next = this.querySelector('[data-carousel-next]');
      this.thumb = this.querySelector('[data-carousel-thumb]');

      this.onScroll = () => this.requestUpdate();
      this.track.addEventListener('scroll', this.onScroll, { passive: true });
      this.prev?.addEventListener('click', () => this.page(-1));
      this.next?.addEventListener('click', () => this.page(1));

      this.track.addEventListener('pointerdown', this.onPointerDown);
      this.track.addEventListener('click', this.onClickCapture, true);
      this.track.addEventListener('dragstart', (event) => event.preventDefault());

      this.resizeObserver = new ResizeObserver(() => this.requestUpdate());
      this.resizeObserver.observe(this.track);

      this.requestUpdate();
    }

    disconnectedCallback() {
      this.track?.removeEventListener('scroll', this.onScroll);
      this.resizeObserver?.disconnect();
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
    }

    /* ---------- Estado: flechas, progreso, altura de las flechas ---------- */

    requestUpdate() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.update();
      });
    }

    update() {
      const { scrollLeft, scrollWidth, clientWidth } = this.track;
      const max = Math.max(0, scrollWidth - clientWidth);
      const scrollable = max > 2;

      this.classList.toggle('is-scrollable', scrollable);
      if (this.prev) this.prev.hidden = !scrollable || scrollLeft <= 2;
      if (this.next) this.next.hidden = !scrollable || scrollLeft >= max - 2;

      if (this.thumb) {
        const size = scrollable ? clientWidth / scrollWidth : 1;
        const position = max ? scrollLeft / max : 0;
        this.thumb.style.setProperty('--thumb-size', size.toFixed(4));
        this.thumb.style.setProperty('--thumb-position', position.toFixed(4));
      }

      const media = this.track.querySelector('.saucha-product-card__media');
      if (media) this.style.setProperty('--carousel-arrow-top', `${media.offsetHeight / 2}px`);
    }

    /* ---------- Flechas: una página, alineada a la tarjeta ---------- */

    page(direction) {
      const items = Array.from(this.track.children);
      if (!items.length) return;

      const gap = parseFloat(getComputedStyle(this.track).columnGap) || 0;
      const step = items[0].getBoundingClientRect().width + gap;
      const perPage = Math.max(1, Math.floor((this.track.clientWidth + gap) / step));

      this.track.scrollBy({
        left: direction * perPage * step,
        behavior: REDUCED_MOTION.matches ? 'auto' : 'smooth',
      });
    }

    /* ---------- Arrastre con ratón ---------- */

    onPointerDown = (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (!this.classList.contains('is-scrollable')) return;

      this.drag = { x: event.clientX, left: this.track.scrollLeft, moved: false };
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp, { once: true });
    };

    onPointerMove = (event) => {
      if (!this.drag) return;
      const delta = event.clientX - this.drag.x;

      if (!this.drag.moved && Math.abs(delta) > DRAG_THRESHOLD) {
        this.drag.moved = true;
        this.classList.add('is-dragging');
      }
      if (this.drag.moved) this.track.scrollLeft = this.drag.left - delta;
    };

    onPointerUp = () => {
      window.removeEventListener('pointermove', this.onPointerMove);
      if (!this.drag) return;

      const moved = this.drag.moved;
      this.drag = null;
      this.classList.remove('is-dragging');
      this.suppressClick = moved;

      // Al soltar, vuelve a encajar en la tarjeta más cercana
      if (moved) this.snap();
    };

    onClickCapture = (event) => {
      if (!this.suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      this.suppressClick = false;
    };

    snap() {
      const items = Array.from(this.track.children);
      const origin = this.track.getBoundingClientRect().left;
      let target = 0;
      let best = Infinity;

      for (const item of items) {
        const offset = item.getBoundingClientRect().left - origin;
        if (Math.abs(offset) < best) {
          best = Math.abs(offset);
          target = this.track.scrollLeft + offset;
        }
      }

      this.track.scrollTo({ left: target, behavior: REDUCED_MOTION.matches ? 'auto' : 'smooth' });
    }
  }

  customElements.define('saucha-carousel', SauchaCarousel);
})();
