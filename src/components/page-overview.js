function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class PageOverview extends HTMLElement {
  static get observedAttributes() {
    return ['title', 'description'];
  }

  connectedCallback() {
    this.style.display = 'block';

    const title = escapeHtml(this.getAttribute('title'));
    const description = escapeHtml(this.getAttribute('description'));

    this.innerHTML = `
      <header class="rounded-3xl border border-cyan-400/20 bg-slate-900/80 p-6 shadow-2xl shadow-cyan-500/10">
        <div class="w-full">
          <h2 class="text-xl font-bold text-cyan-100 sm:text-2xl">${title}</h2>
          <p class="mt-2 text-sm text-slate-300 sm:text-base">${description}</p>
        </div>
      </header>
    `;
  }

  attributeChangedCallback() {
    if (!this.isConnected) return;
    this.connectedCallback();
  }
}

if (!customElements.get('page-overview')) {
  customElements.define('page-overview', PageOverview);
}
