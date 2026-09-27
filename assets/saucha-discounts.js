/*
  SAUCHA · DESCUENTOS AUTOMÁTICOS ANTES DEL CARRITO
  ---------------------------------------------------------------
  Shopify no expone los descuentos automáticos en Liquid fuera del carrito: `variant.price`
  es siempre el precio de catálogo. Para enseñar el precio real antes de añadir, se lo
  preguntamos a Shopify con la Storefront Cart API: se crea un carrito auxiliar (nunca el del
  cliente) con 1 unidad de la variante y se lee lo que Shopify aplicaría de verdad:
  descuentos automáticos, combinabilidad, mercado y moneda. No se calcula nada aquí.

  · Un carrito por variante (así un descuento con compra mínima no se activa por sumar líneas).
  · Varias variantes en una sola petición (alias de GraphQL), en lotes de 8.
  · Caché de 10 minutos por variante y mercado (sessionStorage).
  · Si la API no responde (p. ej. tienda con contraseña y sin token), no se muestra nada:
    nunca hay un precio que luego no coincida con el carrito.

  Acceso: sin token cuando la tienda está abierta; con token público de Storefront si se define
  en Configuración del tema › Saucha › Descuentos (necesario mientras la tienda tenga contraseña).

  Dónde se pinta:
    Ficha ........ product-price de la sección de producto y la barra fija (se repinta tras cada
                   cambio de variante, que Horizon hace sustituyendo el HTML del precio)
    Tarjetas ..... .saucha-product-card (colección, «También te puede gustar»…), también al pulsar muestras
*/
import { formatMoney } from '@theme/money-formatting';

const config = window.SauchaStore || {};
// La Storefront API vive en la raíz del dominio (sin prefijo de idioma)
const API = `/api/${config.apiVersion || '2025-10'}/graphql.json`;
const CACHE_KEY = 'saucha-discounts:v1';
const CACHE_MS = 10 * 60 * 1000;
const BATCH = 8;

/* ---------- Consulta a Shopify ---------- */

/** @type {Map<string, Promise<Estimate | null>>} */
const inflight = new Map();
/** @type {Map<string, {resolve: Function}>} */
const queue = new Map();
let timer = 0;
let disabled = false;

/**
 * @typedef {{ variantId: string, original: number, final: number, currency: string, titles: string[] }} Estimate
 */

const readCache = () => {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeCache = (id, value) => {
  try {
    const cache = readCache();
    cache[`${config.country}:${id}`] = { t: Date.now(), v: value };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* sin almacenamiento: se vuelve a preguntar */
  }
};

const fromCache = (id) => {
  const hit = readCache()[`${config.country}:${id}`];
  return hit && Date.now() - hit.t < CACHE_MS ? hit : null;
};

const LINE_FIELDS = `
  cart {
    lines(first: 1) {
      nodes {
        cost {
          amountPerQuantity { amount currencyCode }
          subtotalAmount { amount }
          totalAmount { amount }
        }
        discountAllocations {
          discountedAmount { amount }
          ... on CartAutomaticDiscountAllocation { title }
        }
      }
    }
  }
  userErrors { message }
`;

async function flush() {
  timer = 0;
  const ids = Array.from(queue.keys()).slice(0, BATCH);
  const waiting = ids.map((id) => [id, queue.get(id)]);
  ids.forEach((id) => queue.delete(id));
  if (queue.size) timer = window.setTimeout(flush, 0);

  const country = config.country ? `country: ${config.country}` : '';
  const language = config.language ? `language: ${config.language}` : '';
  const context = country || language ? `@inContext(${[country, language].filter(Boolean).join(', ')})` : '';
  const body = ids
    .map(
      (id, i) =>
        `c${i}: cartCreate(input: { lines: [{ merchandiseId: "gid://shopify/ProductVariant/${id}", quantity: 1 }] }) { ${LINE_FIELDS} }`
    )
    .join('\n');

  let data = null;
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (config.storefrontToken) headers['X-Shopify-Storefront-Access-Token'] = config.storefrontToken;
    const response = await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: `mutation SauchaPrice ${context} { ${body} }` }),
    });
    const json = await response.json();
    if (!response.ok || !json.data) {
      // Tienda cerrada sin token, u otro rechazo: se desactiva para no repetir la petición en cada tarjeta
      disabled = true;
      if (json?.errors?.[0]?.message) console.info('[Saucha] Precios con descuento no disponibles:', json.errors[0].message);
    }
    data = json.data || null;
  } catch {
    data = null;
  }

  waiting.forEach(([id, entry], i) => {
    const line = data?.[`c${i}`]?.cart?.lines?.nodes?.[0];
    let estimate = null;
    if (line) {
      const original = Number(line.cost.subtotalAmount.amount);
      const final = Number(line.cost.totalAmount.amount);
      const titles = (line.discountAllocations || [])
        .filter((allocation) => Number(allocation.discountedAmount?.amount) > 0)
        .map((allocation) => allocation.title)
        .filter(Boolean);
      estimate = {
        variantId: id,
        original,
        final,
        currency: line.cost.amountPerQuantity.currencyCode,
        titles,
      };
    }
    if (data) writeCache(id, estimate);
    entry.resolve(estimate);
  });
}

/**
 * Precio que Shopify aplicaría a 1 unidad de la variante.
 * @param {string | number} variantId
 * @returns {Promise<Estimate | null>}
 */
export function estimate(variantId) {
  const id = String(variantId || '');
  if (!id || disabled) return Promise.resolve(null);

  const cached = fromCache(id);
  if (cached) return Promise.resolve(cached.v);
  if (inflight.has(id)) return /** @type {Promise<Estimate|null>} */ (inflight.get(id));

  const promise = new Promise((resolve) => {
    queue.set(id, { resolve });
    if (!timer) timer = window.setTimeout(flush, 30);
  }).finally(() => inflight.delete(id));

  inflight.set(id, /** @type {Promise<Estimate|null>} */ (promise));
  return /** @type {Promise<Estimate|null>} */ (promise);
}

/* ---------- Presentación ---------- */

const money = (amount, currency) =>
  formatMoney(Math.round(amount * 100), config.moneyFormat || '{{amount_with_comma_separator}} €', currency || config.currency);

/** Hay descuento real si Shopify rebaja el total de la línea (al menos 1 céntimo). */
const isDiscounted = (e) => !!e && e.final < e.original - 0.004;

const percentOff = (from, to) => Math.round((1 - to / from) * 100);

/**
 * Precio de la ficha y de la barra fija. Sustituye el contenido de [ref="priceContainer"].
 * La referencia tachada es el precio de comparación si existe (y es mayor) o, si no, el precio de catálogo.
 * @param {Element} container
 * @param {Estimate} e
 * @param {number} compareAt - en unidades de moneda (0 si no hay)
 */
function paintProductPrice(container, e, compareAt) {
  const reference = compareAt > e.original ? compareAt : e.original;
  const off = percentOff(reference, e.final);
  const title = e.titles[0];
  const saving = reference - e.final;

  container.innerHTML = `
    <span class="price-item__group price s-price-final">
      <span class="visually-hidden">Precio con descuento&nbsp;</span>${money(e.final, e.currency)}
    </span>
    <span class="price-item__group price-item--regular compare-at-price">
      <span class="visually-hidden">Precio original&nbsp;</span>${money(reference, e.currency)}
    </span>
    ${off > 0 ? `<span class="s-price-badge">&minus;${off}%</span>` : ''}
    <span class="s-price-promo">
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 2.5h5l6 6-5 5-6-6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/></svg>
      <span>${title ? `${escapeHtml(title)} · ` : ''}ahorras ${money(saving, e.currency)} · se aplica en el carrito</span>
    </span>
  `;
  container.dataset.sauchaPromo = e.variantId;
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- Ficha de producto ---------- */

/** Variante elegida: el JSON que Horizon vuelve a pintar dentro del selector en cada cambio. */
function selectedVariant(section) {
  const script = section.querySelector('variant-picker script[type="application/json"]');
  if (script) {
    try {
      const variant = JSON.parse(script.textContent || 'null');
      if (variant?.id) return variant;
    } catch {
      /* sigue abajo */
    }
  }
  const input = section.querySelector('form[action*="/cart/add"] input[name="id"]');
  return input?.value ? { id: input.value, compare_at_price: 0 } : null;
}

async function refreshProduct(section) {
  const variant = selectedVariant(section);
  if (!variant) return;

  const containers = [
    ...section.querySelectorAll('product-price [ref="priceContainer"]'),
    ...document.querySelectorAll('.sticky-add-to-cart__price [ref="priceContainer"]'),
  ];
  const pending = containers.filter((c) => c.dataset.sauchaPromo !== String(variant.id));
  if (!pending.length) return;

  const e = await estimate(variant.id);
  // Si entretanto se eligió otra variante, esta respuesta ya no vale
  if (String(selectedVariant(section)?.id) !== String(variant.id)) return;

  section.classList.toggle('has-saucha-promo', isDiscounted(e));
  if (!isDiscounted(e)) return;

  const compareAt = (Number(variant.compare_at_price) || 0) / 100;
  pending.forEach((container) => paintProductPrice(container, /** @type {Estimate} */ (e), compareAt));
}

/* ---------- Tarjetas ---------- */

async function refreshCard(card, variantId, compareAtCents = null) {
  if (!variantId || card.dataset.sauchaPromo === String(variantId)) return;
  card.dataset.sauchaPromo = String(variantId);

  const e = await estimate(variantId);
  if (card.dataset.sauchaPromo !== String(variantId)) return;

  const wrapper = card.querySelector('[data-price-wrapper]');
  const current = card.querySelector('[data-current-price]');
  const compare = card.querySelector('[data-compare-price]');
  const badge = card.querySelector('[data-sale-badge]');
  card.querySelector('.s-card-promo')?.remove();

  if (!isDiscounted(e) || !wrapper || !current) {
    card.classList.remove('has-saucha-promo');
    return;
  }

  const est = /** @type {Estimate} */ (e);
  const shownCompare = Number(compareAtCents ?? card.dataset.compareAt ?? 0) / 100;
  const reference = shownCompare > est.original ? shownCompare : est.original;
  const off = percentOff(reference, est.final);

  current.textContent = money(est.final, est.currency);
  if (compare) {
    compare.textContent = money(reference, est.currency);
    compare.classList.remove('is-hidden');
  }
  wrapper.classList.add('is-on-sale');
  card.classList.add('is-on-sale', 'has-saucha-promo');

  if (off > 0) wrapper.insertAdjacentHTML('beforeend', `<span class="s-card-promo">&minus;${off}%</span>`);
  badge?.classList.remove('is-hidden');
}

const cardVariant = (card) =>
  card.querySelector('[data-product-swatch].is-active')?.getAttribute('data-variant-id') || card.dataset.variantId;

/* ---------- Arranque ---------- */

function scan(root = document) {
  if (disabled) return;

  root.querySelectorAll('.product-information').forEach((info) => {
    const section = info.closest('.shopify-section') || info;
    refreshProduct(section);
  });

  const cards = root.querySelectorAll('.saucha-product-card[data-variant-id]');
  if (!cards.length) return;

  // Tarjetas: solo cuando se acercan a la pantalla
  const io =
    scan.io ||
    (scan.io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          scan.io.unobserve(entry.target);
          const active = entry.target.querySelector('[data-product-swatch].is-active');
          refreshCard(entry.target, cardVariant(entry.target), active?.getAttribute('data-compare-at') ?? null);
        });
      },
      { rootMargin: '400px 0px' }
    ));
  cards.forEach((card) => {
    // Las que ya están en pantalla (o cerca) se resuelven al momento; el resto al acercarse
    const rect = card.getBoundingClientRect();
    if (rect.bottom > -400 && rect.top < window.innerHeight + 400) {
      const active = card.querySelector('[data-product-swatch].is-active');
      refreshCard(card, cardVariant(card), active?.getAttribute('data-compare-at') ?? null);
    } else {
      io.observe(card);
    }
  });
}

// Cambios de variante en la ficha: Horizon sustituye el precio y el selector → se vuelve a pintar
const observer = new MutationObserver((mutations) => {
  const sections = new Set();
  for (const m of mutations) {
    const el = m.target instanceof Element ? m.target : m.target.parentElement;
    if (!el || el.closest('.s-price-promo')) continue;
    if (el.closest('product-price, variant-picker, .sticky-add-to-cart__price')) {
      const section = el.closest('.shopify-section') || document.querySelector('.product-information')?.closest('.shopify-section');
      if (section) sections.add(section);
    }
  }
  sections.forEach((section) => {
    section.querySelectorAll('product-price [ref="priceContainer"]').forEach((c) => {
      if (!c.querySelector('.s-price-promo')) delete c.dataset.sauchaPromo;
    });
    document.querySelectorAll('.sticky-add-to-cart__price [ref="priceContainer"]').forEach((c) => {
      if (!c.querySelector('.s-price-promo')) delete c.dataset.sauchaPromo;
    });
    refreshProduct(section);
  });
});

// Muestras de las tarjetas: saucha-collection.js cambia precio e imagen; después se aplica el descuento
document.addEventListener('click', (event) => {
  const swatch = event.target instanceof Element ? event.target.closest('[data-product-swatch]') : null;
  const card = swatch?.closest('.saucha-product-card');
  if (!card) return;
  window.setTimeout(() => {
    delete card.dataset.sauchaPromo;
    refreshCard(card, swatch.getAttribute('data-variant-id'), swatch.getAttribute('data-compare-at'));
  }, 0);
});

const start = () => {
  scan();
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

// Contenido que llega después (recomendaciones, filtros, editor)
new MutationObserver((mutations) => {
  for (const m of mutations) {
    m.addedNodes.forEach((node) => {
      if (node instanceof Element && (node.matches('.saucha-product-card') || node.querySelector('.saucha-product-card'))) {
        scan(node.parentElement || document);
      }
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('shopify:section:load', (event) => scan(/** @type {Element} */ (event.target)));

window.SauchaDiscounts = { estimate, scan };
