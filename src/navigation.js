// Shared URL-state and breadcrumb helpers so in-page tabs behave like real navigation.
const AppNav = (() => {
  const BREADCRUMB_SELECTOR = '[data-breadcrumb]';

  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  function get(key, fallback = '') {
    return getParams().get(key) ?? fallback;
  }

  function buildUrl(patch) {
    const params = getParams();
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') params.delete(key);
      else params.set(key, String(value));
    });

    const query = params.toString();
    return `${window.location.pathname}${query ? `?${query}` : ''}`;
  }

  function setParams(patch, { replace = false } = {}) {
    const url = buildUrl(patch);
    if (url === `${window.location.pathname}${window.location.search}`) return false;

    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    return true;
  }

  function onChange(handler) {
    window.addEventListener('popstate', () => handler(getParams()));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Items are { label, href } for cross-page links, { label, params } for in-page
  // state changes, or { label } for the current location.
  function renderBreadcrumb(items, onNavigate) {
    const container = document.querySelector(BREADCRUMB_SELECTOR);
    if (!container) return;

    const trail = (Array.isArray(items) ? items : []).filter((item) => item && item.label);
    const separator = '<li aria-hidden="true" class="select-none text-slate-600">/</li>';
    const linkClasses = 'rounded px-1 text-slate-400 transition-colors hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60';

    container.innerHTML = `<ol class="flex flex-wrap items-center gap-2 text-xs font-semibold">${trail.map((item, index) => {
      const isLast = index === trail.length - 1;
      const cell = isLast || (!item.href && !item.params)
        ? `<span class="px-1 text-cyan-200"${isLast ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</span>`
        : `<a class="${linkClasses}" href="${escapeHtml(item.href || buildUrl(item.params))}"${item.params ? ` data-breadcrumb-index="${index}"` : ''}>${escapeHtml(item.label)}</a>`;

      return `${index > 0 ? separator : ''}<li>${cell}</li>`;
    }).join('')}</ol>`;

    container.querySelectorAll('[data-breadcrumb-index]').forEach((link) => {
      const item = trail[Number(link.getAttribute('data-breadcrumb-index'))];
      if (!item) return;

      link.addEventListener('click', (event) => {
        event.preventDefault();
        setParams(item.params);
        if (typeof onNavigate === 'function') onNavigate();
      });
    });
  }

  return { getParams, get, setParams, onChange, renderBreadcrumb };
})();
