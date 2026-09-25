/*
  Saucha · motion global
  Revela [data-s-reveal] al entrar en pantalla (una sola vez).
  El estado inicial oculto solo existe con html.s-motion, que añade
  snippets/saucha-foundation.liquid; sin JS todo queda visible.
*/
(() => {
  if (window.SauchaMotion) return;

  const root = document.documentElement;
  const SELECTOR = '[data-s-reveal]:not(.is-in)';

  const reveal = (element) => element.classList.add('is-in');

  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              reveal(entry.target);
              observer.unobserve(entry.target);
            });
          },
          { threshold: 0.15, rootMargin: '0px 0px -6% 0px' }
        )
      : null;

  const scan = (scope = document) => {
    if (!root.classList.contains('s-motion')) return;

    scope.querySelectorAll(SELECTOR).forEach((element) => {
      if (observer) observer.observe(element);
      else reveal(element);
    });
  };

  window.SauchaMotion = { scan, reveal };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan());
  } else {
    scan();
  }

  /* Editor de temas: las secciones se vuelven a renderizar y deben verse al instante */
  document.addEventListener('shopify:section:load', (event) => {
    event.target.querySelectorAll(SELECTOR).forEach(reveal);
  });

  document.addEventListener('shopify:block:select', (event) => {
    const section = event.target.closest('.shopify-section');
    section?.querySelectorAll(SELECTOR).forEach(reveal);
  });
})();
