/*
  SAUCHA · FICHA DE PRODUCTO · microinteracciones
  ---------------------------------------------------------------
  La lógica de variantes, precio, stock y carrito es la de Horizon; aquí solo
  se añade comportamiento de presentación. Todo va por delegación en document
  porque Horizon vuelve a pintar (morph) el selector y la galería al cambiar de variante.

  1 · Etiqueta de color en la galería ... pulsar «Plateado» elige ese color
  2 · Vista previa de color ............. al pasar por una muestra, la leyenda dice su nombre
  3 · Cambios con intención .............. precio, stock y valor elegido entran con un fundido corto
  4 · Paneles laterales .................. Descripción, Detalles, Talla y ajuste, Envíos, Preguntar
  5 · Copiar enlace ...................... botón de compartir
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

  /* ---------- 4 · Paneles laterales (blocks/saucha-product-info.liquid) ---------- */

  const DRAWER_EXIT_MS = 320;

  /**
   * @param {Element} origin
   * @param {string} key
   * @returns {HTMLDialogElement | null}
   */
  const findDrawer = (origin, key) => {
    const scope = origin.closest('.shopify-section') || document;
    const drawer = scope.querySelector(`dialog[data-saucha-drawer="${CSS.escape(key)}"]`);
    return drawer instanceof HTMLDialogElement ? drawer : null;
  };

  const lockScroll = (locked) => document.documentElement.classList.toggle('s-drawer-lock', locked);

  /** @param {HTMLDialogElement} drawer */
  const openDrawer = (drawer, opener = null) => {
    if (drawer.open) return;
    drawer.sauchaOpener = opener;
    drawer.classList.remove('is-closing');
    drawer.showModal();
    lockScroll(true);
    requestAnimationFrame(() => drawer.classList.add('is-open'));
  };

  /** @param {HTMLDialogElement} drawer */
  const closeDrawer = (drawer) => {
    if (!drawer.open || drawer.classList.contains('is-closing')) return;
    drawer.classList.remove('is-open');
    drawer.classList.add('is-closing');
    window.setTimeout(
      () => {
        drawer.classList.remove('is-closing');
        drawer.close();
        lockScroll(false);
        drawer.sauchaOpener?.focus?.({ preventScroll: true });
      },
      REDUCED_MOTION.matches ? 0 : DRAWER_EXIT_MS
    );
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const opener = target.closest('[data-saucha-drawer-open]');
    if (opener) {
      const drawer = findDrawer(opener, opener.getAttribute('data-saucha-drawer-open') || '');
      if (drawer) {
        event.preventDefault();
        openDrawer(drawer, opener);
      }
      return;
    }

    if (target.closest('[data-saucha-drawer-close]')) {
      const drawer = target.closest('dialog[data-saucha-drawer]');
      if (drawer instanceof HTMLDialogElement) closeDrawer(drawer);
      return;
    }

    // Clic en el fondo: el propio <dialog> ocupa la pantalla y el panel va dentro
    if (target instanceof HTMLDialogElement && target.matches('[data-saucha-drawer]')) {
      closeDrawer(target);
    }
  });

  // Esc: se anima la salida en lugar del cierre seco del navegador
  document.addEventListener(
    'cancel',
    (event) => {
      const drawer = event.target;
      if (drawer instanceof HTMLDialogElement && drawer.matches('[data-saucha-drawer]')) {
        event.preventDefault();
        closeDrawer(drawer);
      }
    },
    true
  );

  // Al volver de enviar la pregunta (o con errores), el panel se abre para enseñar el resultado
  const openPostedForm = () => {
    const status = document.querySelector('dialog[data-saucha-drawer] [data-saucha-open-on-load]');
    const drawer = status?.closest('dialog');
    if (drawer instanceof HTMLDialogElement) {
      openDrawer(drawer);
      if (status instanceof HTMLElement) status.focus({ preventScroll: true });
    }
  };

  /* ---------- 5 · Copiar enlace ---------- */

  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-saucha-copy]') : null;
    if (!button) return;

    const url = button.getAttribute('data-saucha-copy') || window.location.href;
    const feedback = button.querySelector('.s-pdp-share__copied');
    try {
      await navigator.clipboard.writeText(url);
      if (feedback) feedback.textContent = 'Enlace copiado';
    } catch {
      window.prompt('Copia el enlace', url);
      return;
    }
    button.classList.add('is-copied');
    window.setTimeout(() => {
      button.classList.remove('is-copied');
      if (feedback) feedback.textContent = '';
    }, 1800);
  });

  window.SauchaProduct = { flash, openDrawer, closeDrawer };

  const init = () => {
    watch();
    openPostedForm();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('shopify:section:load', watch);
})();
