import { Component } from '@theme/component';
import { ThemeEvents, ZoomMediaSelectedEvent } from '@theme/events';
import { StandardEvents, ProductSelectEvent } from '@shopify/events';

/**
 * A custom element that renders a media gallery.
 *
 * @typedef {object} Refs
 * @property {import('./zoom-dialog').ZoomDialog} [zoomDialogComponent] - The zoom dialog component.
 * @property {import('./slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {HTMLElement[]} [media] - The media elements.
 *
 * @extends Component<Refs>
 */
export class MediaGallery extends Component {
  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#controller;
    const target = this.closest('.shopify-section, dialog');

    target?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect, { signal });
    this.refs.zoomDialogComponent?.addEventListener(ThemeEvents.zoomMediaSelected, this.#handleZoomMediaSelected, {
      signal,
    });
  }

  #controller = new AbortController();

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#controller.abort();
  }

  /**
   * Handles a product select event by replacing the current media gallery with a new one.
   *
   * @param {ProductSelectEvent} event - The product select event.
   */
  #handleProductSelect = (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card')) return;

    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html } = detail;
        const newMediaGallery = html.querySelector('media-gallery');
        if (!newMediaGallery) return;

        // SAUCHA: si el grupo de imágenes no cambia (p. ej. solo cambia la talla) no se toca la galería
        const signature = newMediaGallery.dataset.mediaSignature;
        // (si hay un cambio en curso hacia otro color, sí se procesa para volver a este)
        if (signature && signature === this.dataset.mediaSignature && !this.#pendingGallery) return;

        this.#swapGallery(newMediaGallery);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[media-gallery] Event promise rejected:', error);
      });
  };

  /** SAUCHA: galería que espera a sustituir a esta (la última elegida gana si se pulsan varios colores seguidos). */
  #pendingGallery = null;

  /**
   * SAUCHA: cambio de color sin saltos.
   * 1. La galería actual se desvanece (salida corta).
   * 2. Mientras, se descodifican las primeras fotos de la nueva, así nunca entra en blanco.
   * 3. La nueva entra con un asentado escalonado (ver .is-entering / .is-arriving en saucha-product.css).
   * Si la galería quedaba por encima de la pantalla, se vuelve a su inicio para ver el color elegido.
   * @param {HTMLElement} newMediaGallery - La galería nueva.
   */
  async #swapGallery(newMediaGallery) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !this.isConnected) {
      this.replaceWith(newMediaGallery);
      return;
    }

    const alreadyLeaving = this.#pendingGallery !== null;
    this.#pendingGallery = newMediaGallery;
    if (alreadyLeaving) return;

    // Congela la altura para que la columna de detalles (sticky) no salte durante el cruce
    this.style.minHeight = `${this.offsetHeight}px`;
    this.classList.add('is-leaving');

    await Promise.all([wait(260), preloadFirstImages(newMediaGallery)]);

    const next = this.#pendingGallery;
    if (!next || !this.isConnected) return;

    const top = this.getBoundingClientRect().top;
    next.classList.add('is-entering', 'is-arriving');
    this.replaceWith(next);

    if (top < 0) next.scrollIntoView({ behavior: 'smooth', block: 'start' });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => next.classList.remove('is-entering'));
    });
    window.setTimeout(() => next.classList.remove('is-arriving'), 1400);
  }

  /**
   * Handles the 'zoom-media:selected' event.
   * @param {ZoomMediaSelectedEvent} event - The zoom-media:selected event.
   */
  #handleZoomMediaSelected = async (event) => {
    this.slideshow?.select(event.detail.index, undefined, { animate: false });
  };

  /**
   * Zooms the media gallery.
   *
   * @param {number} index - The index of the media to zoom.
   * @param {PointerEvent} event - The pointer event.
   */
  zoom(index, event) {
    this.refs.zoomDialogComponent?.open(index, event);
  }

  /**
   * Preloads an image.
   * @param {number} index - The index of the media to preload.
   */
  preloadImage(index) {
    const zoomDialogMedia = this.refs.zoomDialogComponent?.refs.media[index];
    if (!zoomDialogMedia) return;

    this.refs.zoomDialogComponent?.loadHighResolutionImage(zoomDialogMedia);
  }

  get slideshow() {
    return this.refs.slideshow;
  }

  get media() {
    return this.refs.media;
  }

  get presentation() {
    return this.dataset.presentation;
  }
}

/**
 * SAUCHA: espera.
 * @param {number} ms
 */
function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * SAUCHA: descodifica las fotos que se verán primero en la galería nueva
 * (2 de la rejilla en escritorio, 1 del carrusel en móvil). Nunca espera más de 700 ms.
 * @param {HTMLElement} gallery
 */
function preloadFirstImages(gallery) {
  const isDesktop = window.matchMedia('(min-width: 750px)').matches;
  const selector =
    isDesktop && gallery.querySelector('.media-gallery__grid')
      ? '.media-gallery__grid > li img'
      : 'slideshow-slide img';
  const images = Array.from(gallery.querySelectorAll(selector)).slice(0, isDesktop ? 2 : 1);

  const loads = images.map((source) => {
    const image = new Image();
    if (source.sizes) image.sizes = source.sizes;
    if (source.srcset) image.srcset = source.srcset;
    image.src = source.currentSrc || source.src;
    return image.decode().catch(() => {});
  });

  return Promise.race([Promise.all(loads), wait(700)]);
}

if (!customElements.get('media-gallery')) {
  customElements.define('media-gallery', MediaGallery);
}
