/*
  SAUCHA · FICHA DE PRODUCTO · microinteracciones
  ---------------------------------------------------------------
  La lógica de variantes, precio, stock y carrito es la de Horizon; aquí solo
  se añade comportamiento de presentación. Todo va por delegación en document
  porque Horizon vuelve a pintar (morph) el selector y la galería al cambiar de variante.

  1 · Etiqueta de color en la galería ... pulsar «Plateado» elige ese color
  2 · Vista previa de color ............. al pasar por una muestra, la leyenda dice su nombre
  3 · Cambios con intención .............. precio, stock y valor elegido entran con un fundido corto
*/
(() => {
  if (window.SauchaProduct) return;

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- 1 · Etiqueta de color → selecciona el color ---------- */

  /**
   * Busca, en la misma sección, el radio del selector cuyo valor es el color pedido.
   * @param {Element} origin
   * @param {string} color
   * @returns {HTMLInputElement | null}
   */
  const findColorInput = (origin, color) => {
    const scope = origin.closest('.shopify-section') || document;
    const inputs = scope.querySelectorAll('variant-picker input[type="radio"]');
    for (const input of inputs) {
      if (input instanceof HTMLInputElement && input.value === color) return input;
    }
    return null;
  };

  // Fase de captura: se atiende antes que el clic de la diapositiva (que abre el zoom)
  document.addEventListener(
    'click',
    (event) => {
      const tag = event.target instanceof Element ? event.target.closest('[data-saucha-select-color]') : null;
      if (!tag) return;

      event.preventDefault();
      event.stopPropagation();

      const input = findColorInput(tag, tag.getAttribute('data-saucha-select-color') || '');
      if (!input || input.checked) return;

      tag.classList.add('is-pressed');
      input.click();
    },
    true
  );

  /* ---------- 2 · Vista previa del nombre del color ---------- */

  /** @param {Element} label */
  const legendValueFor = (label) =>
    label.closest('fieldset')?.querySelector('legend .variant-option__swatch-value') || null;

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const label = event.target instanceof Element ? event.target.closest('.variant-option__button-label--has-swatch') : null;
    if (!label || label.contains(/** @type {Node} */ (event.relatedTarget))) return;

    const value = legendValueFor(label);
    const input = label.querySelector('input');
    if (!value || !input) return;

    if (!value.dataset.sauchaSelected) value.dataset.sauchaSelected = value.textContent?.trim() || '';
    if (value.textContent?.trim() !== input.value) {
      value.textContent = input.value;
      value.classList.toggle('is-previewing', !input.checked);
    }
  });

  document.addEventListener('pointerout', (event) => {
    const label = event.target instanceof Element ? event.target.closest('.variant-option__button-label--has-swatch') : null;
    if (!label || label.contains(/** @type {Node} */ (event.relatedTarget))) return;

    const value = legendValueFor(label);
    if (!value) return;

    const checked = label.closest('fieldset')?.querySelector('input:checked');
    const selected = checked instanceof HTMLInputElement ? checked.value : value.dataset.sauchaSelected || '';
    value.textContent = selected;
    value.classList.remove('is-previewing');
    delete value.dataset.sauchaSelected;
  });

  /* ---------- 3 · Cambios con intención ---------- */

  const FLASH_TARGETS = [
    'product-price [ref="priceContainer"]',
    '.product-inventory__status',
    '.variant-option__swatch-value',
    '.sticky-add-to-cart__variant',
  ].join(',');

  /** @param {Element} element */
  const flash = (element) => {
    if (REDUCED_MOTION.matches || element.classList.contains('is-previewing')) return;
    element.classList.remove('s-flash');
    // fuerza el reinicio de la animación
    void (/** @type {HTMLElement} */ (element).offsetWidth);
    element.classList.add('s-flash');
  };

  const pending = new Set();
  let frame = 0;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const node = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      const target = node?.closest(FLASH_TARGETS) || (node?.matches?.(FLASH_TARGETS) ? node : null);
      if (target && !target.closest('.s-pdp-media-tag')) pending.add(target);
    }
    if (!pending.size || frame) return;
    frame = requestAnimationFrame(() => {
      pending.forEach(flash);
      pending.clear();
      frame = 0;
    });
  });

  const watch = () => {
    document.querySelectorAll('.product-information, sticky-add-to-cart').forEach((root) => {
      if (root instanceof HTMLElement && !root.dataset.sauchaWatched) {
        root.dataset.sauchaWatched = 'true';
        observer.observe(root, { childList: true, characterData: true, subtree: true });
      }
    });
  };

  document.addEventListener('animationend', (event) => {
    if (event.target instanceof Element && event.animationName === 's-flash') event.target.classList.remove('s-flash');
  });

  window.SauchaProduct = { flash };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }

  document.addEventListener('shopify:section:load', watch);
})();
