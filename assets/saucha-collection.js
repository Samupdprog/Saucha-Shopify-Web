(() => {
  if (customElements.get('saucha-collection')) return;

  const MOBILE_QUERY = '(max-width: 989px)';
  const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

  class SauchaCollection extends HTMLElement {
    connectedCallback() {
      if (this._initialized) return;
      this._initialized = true;
      this.syncThemePalette();
      this.dataset.enhanced = 'true';

      this.sectionId = this.dataset.sectionId;
      this.autoApply = this.dataset.autoApply === 'true';
      this.filterForm = this.querySelector('[data-filter-form]');
      this.sortForm = this.querySelector('[data-sort-form]');
      this.sortSelect = this.querySelector('[data-sort-select]');
      this.drawer = this.querySelector('[data-filter-drawer]');
      this.drawerOpenButton = this.querySelector('[data-filter-open]');
      this.drawerCloseButton = this.querySelector('[data-filter-close]');
      this.drawerBackdrop = this.querySelector('[data-filter-backdrop]');
      this.toolbar = this.querySelector('[data-toolbar]');
      this.results = this.querySelector('[data-results]');
      this.mobileMedia = window.matchMedia(MOBILE_QUERY);
      this.priceDebounce = null;
      this.requestController = null;
      this.lastFocusedElement = null;

      this.onClick = this.onClick.bind(this);
      this.onChange = this.onChange.bind(this);
      this.onSubmit = this.onSubmit.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onPopState = this.onPopState.bind(this);
      this.onScroll = this.onScroll.bind(this);
      this.onViewportChange = this.onViewportChange.bind(this);

      this.addEventListener('click', this.onClick);
      this.addEventListener('change', this.onChange);
      this.addEventListener('submit', this.onSubmit);
      this.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('popstate', this.onPopState);
      window.addEventListener('scroll', this.onScroll, { passive: true });

      if (this.mobileMedia.addEventListener) {
        this.mobileMedia.addEventListener('change', this.onViewportChange);
      } else {
        this.mobileMedia.addListener(this.onViewportChange);
      }

      if (this.toolbar && 'ResizeObserver' in window) {
        this.toolbarResizeObserver = new ResizeObserver(() => this.updateToolbarHeight());
        this.toolbarResizeObserver.observe(this.toolbar);
      }

      this.updateToolbarHeight();
      this.onScroll();
    }

    disconnectedCallback() {
      if (!this._initialized) return;

      this.removeEventListener('click', this.onClick);
      this.removeEventListener('change', this.onChange);
      this.removeEventListener('submit', this.onSubmit);
      this.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('popstate', this.onPopState);
      window.removeEventListener('scroll', this.onScroll);

      if (this.mobileMedia) {
        if (this.mobileMedia.removeEventListener) {
          this.mobileMedia.removeEventListener('change', this.onViewportChange);
        } else {
          this.mobileMedia.removeListener(this.onViewportChange);
        }
      }

      this.toolbarResizeObserver?.disconnect();
      this.requestController?.abort();
      clearTimeout(this.priceDebounce);

      if (this.drawer?.classList.contains('is-open')) {
        document.documentElement.classList.remove('saucha-drawer-open');
      }
    }

    syncThemePalette() {
      const parseRgb = (value, fallback) => {
        const numbers = String(value || '').match(/[\d.]+/g);
        if (!numbers || numbers.length < 3) return fallback;
        return numbers.slice(0, 3).map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
      };

      const isOpaque = (value) => {
        if (!value || value === 'transparent') return false;
        const numbers = String(value).match(/[\d.]+/g);
        if (!numbers || numbers.length < 4) return true;
        return Number(numbers[3]) > 0.01;
      };

      const ownStyle = getComputedStyle(this);
      const foregroundCss = ownStyle.color || 'rgb(18, 18, 18)';
      const foreground = parseRgb(foregroundCss, [18, 18, 18]);

      let surfaceCss = '';
      let node = this.parentElement;
      while (node && node !== document.documentElement) {
        const candidate = getComputedStyle(node).backgroundColor;
        if (isOpaque(candidate)) {
          surfaceCss = candidate;
          break;
        }
        node = node.parentElement;
      }

      if (!surfaceCss) {
        const bodyBackground = getComputedStyle(document.body).backgroundColor;
        surfaceCss = isOpaque(bodyBackground) ? bodyBackground : 'rgb(255, 255, 255)';
      }

      const background = parseRgb(surfaceCss, [255, 255, 255]);
      this.style.setProperty('--saucha-fg', foreground.join(', '));
      this.style.setProperty('--saucha-bg', background.join(', '));
      this.style.setProperty('--saucha-surface-color', surfaceCss);
    }

    updateToolbarHeight() {
      if (!this.toolbar) return;
      const height = Math.ceil(this.toolbar.getBoundingClientRect().height);
      this.style.setProperty('--saucha-toolbar-height', `${height}px`);
    }

    onScroll() {
      if (!this.toolbar) return;
      const stickyTop = parseFloat(getComputedStyle(this).getPropertyValue('--saucha-sticky-top')) || 0;
      const rect = this.toolbar.getBoundingClientRect();
      this.toolbar.classList.toggle('is-stuck', window.scrollY > 0 && rect.top <= stickyTop + 1);
    }

    onViewportChange(event) {
      if (!event.matches && this.drawer?.classList.contains('is-open')) {
        this.closeDrawer(false);
      }
      this.updateToolbarHeight();
    }

    onClick(event) {
      const openButton = event.target.closest('[data-filter-open]');
      if (openButton && this.contains(openButton)) {
        event.preventDefault();
        this.openDrawer();
        return;
      }

      const closeButton = event.target.closest('[data-filter-close]');
      if (closeButton && this.contains(closeButton)) {
        event.preventDefault();
        this.closeDrawer();
        return;
      }

      const backdrop = event.target.closest('[data-filter-backdrop]');
      if (backdrop && this.contains(backdrop)) {
        event.preventDefault();
        this.closeDrawer();
        return;
      }

      const filterSummary = event.target.closest('.saucha-filter-group__summary');
      if (filterSummary && this.contains(filterSummary)) {
        const group = filterSummary.closest('.saucha-filter-group');
        if (group) {
          event.preventDefault();
          this.toggleFilterGroup(group);
          return;
        }
      }

      const swatch = event.target.closest('[data-product-swatch]');
      if (swatch && this.contains(swatch)) {
        event.preventDefault();
        this.selectProductSwatch(swatch);
        return;
      }

      const collectionLink = event.target.closest('[data-collection-link]');
      if (collectionLink && this.contains(collectionLink) && collectionLink.href) {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
        event.preventDefault();
        const fromPagination = Boolean(collectionLink.closest('.saucha-pagination'));
        this.renderUrl(collectionLink.href, { pushState: true, scrollToTop: fromPagination });
      }
    }

    onChange(event) {
      if (event.target === this.sortSelect) {
        this.submitForm(this.sortForm, { pushState: true });
        return;
      }

      if (!this.filterForm || !this.filterForm.contains(event.target)) return;
      if (!this.autoApply || this.mobileMedia.matches) return;

      const isPriceInput = event.target.matches('input[type="number"]');
      clearTimeout(this.priceDebounce);

      if (isPriceInput) {
        this.priceDebounce = setTimeout(() => {
          this.submitForm(this.filterForm, { pushState: true });
        }, 450);
      } else {
        this.priceDebounce = setTimeout(() => {
          this.submitForm(this.filterForm, { pushState: true });
        }, 120);
      }
    }

    onSubmit(event) {
      const form = event.target.closest('form');
      if (!form || !this.contains(form)) return;
      if (form !== this.filterForm && form !== this.sortForm) return;

      event.preventDefault();
      this.submitForm(form, { pushState: true });
    }

    onKeyDown(event) {
      if (!this.drawer?.classList.contains('is-open')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeDrawer();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = this.getFocusableElements(this.drawer);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (!focusable.includes(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    onPopState() {
      /* Fuera de la página de colección (p. ej. Productos Saucha en la home) no hay resultados que recargar */
      if (!this.results) return;
      this.renderUrl(window.location.href, { pushState: false, scrollToTop: false });
    }

    getFocusableElements(container) {
      return [...container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      )].filter((element) => {
        const style = window.getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none';
      });
    }

    toggleFilterGroup(group) {
      const summary = group.querySelector(':scope > .saucha-filter-group__summary');
      const body = group.querySelector(':scope > .saucha-filter-group__body');
      if (!summary || !body || group.dataset.animating === 'true') return;

      const shouldOpen = !group.open;
      const reduceMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;

      if (reduceMotion || typeof group.animate !== 'function') {
        group.open = shouldOpen;
        return;
      }

      group.dataset.animating = 'true';
      delete group.dataset.closing;

      if (shouldOpen) {
        group.open = true;
      } else {
        group.dataset.closing = 'true';
      }

      const startHeight = shouldOpen ? summary.getBoundingClientRect().height : group.getBoundingClientRect().height;
      const endHeight = shouldOpen
        ? summary.getBoundingClientRect().height + body.getBoundingClientRect().height
        : summary.getBoundingClientRect().height;

      group.style.height = `${startHeight}px`;
      group.style.overflow = 'clip';

      const groupAnimation = group.animate(
        {
          height: [`${startHeight}px`, `${endHeight}px`],
        },
        {
          duration: shouldOpen ? 260 : 220,
          easing: shouldOpen ? 'cubic-bezier(0.2, 0.72, 0.2, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)',
        }
      );

      const bodyAnimation = body.animate(
        shouldOpen
          ? [
              { opacity: 0, transform: 'translateY(-5px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ]
          : [
              { opacity: 1, transform: 'translateY(0)' },
              { opacity: 0, transform: 'translateY(-4px)' },
            ],
        {
          duration: shouldOpen ? 220 : 160,
          easing: 'ease',
          fill: 'both',
        }
      );

      groupAnimation.addEventListener('finish', () => {
        if (!shouldOpen) group.open = false;
        group.style.removeProperty('height');
        group.style.removeProperty('overflow');
        delete group.dataset.animating;
        delete group.dataset.closing;
        bodyAnimation.cancel();
      }, { once: true });

      groupAnimation.addEventListener('cancel', () => {
        group.style.removeProperty('height');
        group.style.removeProperty('overflow');
        delete group.dataset.animating;
        delete group.dataset.closing;
        bodyAnimation.cancel();
      }, { once: true });
    }

    openDrawer() {
      if (!this.drawer || !this.mobileMedia.matches) return;

      this.lastFocusedElement = document.activeElement;
      this.drawer.classList.add('is-open');
      this.drawerBackdrop?.classList.add('is-open');
      this.drawerOpenButton?.setAttribute('aria-expanded', 'true');
      this.drawer.setAttribute('role', 'dialog');
      this.drawer.setAttribute('aria-modal', 'true');
      document.documentElement.classList.add('saucha-drawer-open');

      requestAnimationFrame(() => {
        const title = this.drawer.querySelector('[data-drawer-title]');
        title?.focus({ preventScroll: true });
      });
    }

    closeDrawer(restoreFocus = true) {
      if (!this.drawer) return;

      this.drawer.classList.remove('is-open');
      this.drawerBackdrop?.classList.remove('is-open');
      this.drawerOpenButton?.setAttribute('aria-expanded', 'false');
      this.drawer.removeAttribute('role');
      this.drawer.removeAttribute('aria-modal');
      document.documentElement.classList.remove('saucha-drawer-open');

      if (restoreFocus && this.lastFocusedElement instanceof HTMLElement) {
        this.lastFocusedElement.focus({ preventScroll: true });
      }
      this.lastFocusedElement = null;
    }

    submitForm(form, options = {}) {
      if (!form) return;

      const target = new URL(form.action || window.location.href, window.location.origin);
      target.search = '';

      const formData = new FormData(form);
      for (const [key, rawValue] of formData.entries()) {
        const value = String(rawValue).trim();
        if (value !== '') target.searchParams.append(key, value);
      }

      target.searchParams.delete('page');
      this.renderUrl(target.toString(), options);
    }

    captureFilterState() {
      const groups = [...this.querySelectorAll('[data-filter-group]')]
        .filter((group) => group.open)
        .map((group) => group.dataset.filterGroup);

      return {
        groups,
        scrollTop: this.drawer?.scrollTop || 0,
        wasMobileDrawerOpen: Boolean(this.drawer?.classList.contains('is-open')),
      };
    }

    restoreFilterState(freshSection, state) {
      if (!state || state.wasMobileDrawerOpen) return;

      for (const groupName of state.groups) {
        const matchingGroup = [...freshSection.querySelectorAll('[data-filter-group]')]
          .find((group) => group.dataset.filterGroup === groupName);
        if (matchingGroup) matchingGroup.open = true;
      }

      const freshDrawer = freshSection.querySelector('[data-filter-drawer]');
      if (freshDrawer) freshDrawer.scrollTop = state.scrollTop;
    }

    async renderUrl(rawUrl, { pushState = true, scrollToTop = false } = {}) {
      if (!this.sectionId) {
        window.location.assign(rawUrl);
        return;
      }

      const publicUrl = new URL(rawUrl, window.location.origin);
      const requestUrl = new URL(publicUrl.toString());
      requestUrl.searchParams.set('section_id', this.sectionId);

      const filterState = this.captureFilterState();
      this.requestController?.abort();
      const controller = new AbortController();
      this.requestController = controller;
      this.setAttribute('aria-busy', 'true');

      try {
        const response = await fetch(requestUrl.toString(), {
          method: 'GET',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const freshSection = doc.querySelector('saucha-collection[data-section-id]');
        if (!freshSection) throw new Error('No se pudo renderizar la sección de colección.');

        this.restoreFilterState(freshSection, filterState);

        if (pushState) {
          window.history.pushState({}, '', `${publicUrl.pathname}${publicUrl.search}${publicUrl.hash}`);
        }

        this.replaceWith(freshSection);

        if (scrollToTop) {
          const behavior = window.matchMedia(REDUCED_MOTION_QUERY).matches ? 'auto' : 'smooth';
          freshSection.scrollIntoView({ behavior, block: 'start' });
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        window.location.assign(publicUrl.toString());
      } finally {
        if (this.requestController === controller && this.isConnected) {
          this.removeAttribute('aria-busy');
        }
      }
    }

    selectProductSwatch(button) {
      const card = button.closest('[data-product-card]');
      const media = card?.querySelector('[data-card-media]');
      const primaryImage = card?.querySelector('.saucha-product-card__image--primary');
      let secondaryImage = card?.querySelector('.saucha-product-card__image--secondary');

      if (!card || !media) return;

      card.querySelectorAll('[data-product-swatch]').forEach((swatch) => {
        const active = swatch === button;
        swatch.classList.toggle('is-active', active);
        swatch.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      const variantUrl = button.dataset.variantUrl;
      if (variantUrl) {
        card.querySelectorAll('[data-product-link]').forEach((link) => {
          link.href = variantUrl;
        });
      }

      const colorLabel = button.dataset.colorLabel || '';
      const selectedColor = card.querySelector('[data-selected-color]');
      if (selectedColor && colorLabel) selectedColor.textContent = colorLabel;

      const price = button.dataset.price;
      const comparePrice = button.dataset.comparePrice;
      const isSale = button.dataset.isSale === 'true';
      const saleLabel = button.dataset.saleLabel || 'Oferta';
      const available = button.dataset.available === 'true';
      const soldOutLabel = button.dataset.soldOutLabel || 'Agotado';

      const currentPrice = card.querySelector('[data-current-price]');
      const comparePriceElement = card.querySelector('[data-compare-price]');
      const priceWrapper = card.querySelector('[data-price-wrapper]');
      const saleBadge = card.querySelector('[data-sale-badge]');
      const saleBadgeText = card.querySelector('[data-sale-badge-text]');
      const soldOutBadge = card.querySelector('[data-sold-out-badge]');
      const liveStatus = card.querySelector('[data-card-status]');

      if (currentPrice && price) currentPrice.textContent = price;

      if (comparePriceElement) {
        comparePriceElement.textContent = isSale ? comparePrice : '';
        comparePriceElement.classList.toggle('is-hidden', !isSale || !comparePrice);
      }

      priceWrapper?.classList.toggle('is-on-sale', isSale);
      card.classList.toggle('is-on-sale', isSale);

      if (saleBadge) {
        saleBadge.classList.toggle('is-hidden', !isSale);
        if (saleBadgeText) saleBadgeText.textContent = saleLabel;
        if (isSale) {
          saleBadge.setAttribute('aria-label', saleLabel);
        } else {
          saleBadge.removeAttribute('aria-label');
        }
      }

      soldOutBadge?.classList.toggle('is-hidden', available);

      if (liveStatus && colorLabel) {
        liveStatus.textContent = `${colorLabel}${available ? '' : ` — ${soldOutLabel}`}`;
      }

      const primaryUrl = button.dataset.primaryUrl || '';
      const primarySrcset = button.dataset.primarySrcset || '';
      const primaryAlt = button.dataset.primaryAlt || '';
      const secondaryUrl = button.dataset.secondaryUrl || '';
      const secondarySrcset = button.dataset.secondarySrcset || '';
      const secondaryAlt = button.dataset.secondaryAlt || '';

      if (!primaryUrl || !primaryImage) {
        media.dataset.hoverImage = secondaryUrl && secondaryImage ? 'true' : 'false';
        this.flashMedia(media);
        return;
      }

      media.classList.add('is-switching');

      const preload = new Image();
      preload.decoding = 'async';

      preload.onload = () => {
        primaryImage.src = primaryUrl;
        if (primarySrcset) {
          primaryImage.srcset = primarySrcset;
        } else {
          primaryImage.removeAttribute('srcset');
        }
        primaryImage.alt = primaryAlt;

        if (secondaryUrl) {
          if (!secondaryImage) {
            const mediaLink = card.querySelector('.saucha-product-card__media-link');
            if (mediaLink) {
              secondaryImage = document.createElement('img');
              secondaryImage.className = 'saucha-product-card__image saucha-product-card__image--secondary';
              secondaryImage.loading = 'lazy';
              secondaryImage.decoding = 'async';
              secondaryImage.sizes = primaryImage.sizes || '(min-width: 1400px) 22vw, (min-width: 990px) 26vw, (min-width: 750px) 33vw, 50vw';
              mediaLink.appendChild(secondaryImage);
            }
          }

          if (secondaryImage) {
            secondaryImage.classList.remove('is-hidden');
            secondaryImage.src = secondaryUrl;
            if (secondarySrcset) {
              secondaryImage.srcset = secondarySrcset;
            } else {
              secondaryImage.removeAttribute('srcset');
            }
            secondaryImage.alt = secondaryAlt;
          }
        } else if (secondaryImage) {
          secondaryImage.classList.add('is-hidden');
          secondaryImage.removeAttribute('srcset');
          secondaryImage.removeAttribute('src');
          secondaryImage.alt = '';
        }

        media.dataset.hoverImage = secondaryUrl ? 'true' : 'false';
        media.classList.remove('is-switching');
        this.flashMedia(media);
      };

      preload.onerror = () => {
        media.classList.remove('is-switching');
        this.flashMedia(media);
      };

      if (primarySrcset) preload.srcset = primarySrcset;
      preload.src = primaryUrl;
    }

    flashMedia(media) {
      media.classList.remove('variant-flash');
      void media.offsetWidth;
      media.classList.add('variant-flash');
      window.setTimeout(() => media.classList.remove('variant-flash'), 650);
    }
  }

  customElements.define('saucha-collection', SauchaCollection);
})();
