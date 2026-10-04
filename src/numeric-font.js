(() => {
  const NUMBER_PATTERN = /(^|[^\p{L}\p{N}])([+-]?(?:\d{1,3}(?:[, \u00a0\u202f]\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|[kmb]|ms|[hms]|x))?)(?![\p{L}\p{N}])/giu;
  const SKIP_SELECTOR = 'script, style, noscript, textarea, input, select, option, .numeric-value, [data-numeric-font-ignore]';
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

  function decorateTextNode(textNode) {
    const parent = textNode.parentElement;
    const value = textNode.nodeValue || '';
    if (!parent || parent.closest(SKIP_SELECTOR) || !/\d/.test(value)) return;

    NUMBER_PATTERN.lastIndex = 0;
    const matches = Array.from(value.matchAll(NUMBER_PATTERN));
    if (matches.length === 0) return;

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    matches.forEach((match) => {
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      if (start < cursor) return;
      if (start > cursor) fragment.append(document.createTextNode(value.slice(cursor, start)));

      const number = parent.namespaceURI === SVG_NAMESPACE
        ? document.createElementNS(SVG_NAMESPACE, 'tspan')
        : document.createElement('span');
      number.setAttribute('class', 'numeric-value');
      number.textContent = match[2];
      fragment.append(number);
      cursor = end;
    });

    if (cursor === 0) return;
    if (cursor < value.length) fragment.append(document.createTextNode(value.slice(cursor)));
    textNode.replaceWith(fragment);
  }

  function decorateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      decorateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || root.matches(SKIP_SELECTOR)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let textNode;
    while ((textNode = walker.nextNode())) textNodes.push(textNode);
    textNodes.forEach(decorateTextNode);
  }

  if (!document.body) return;
  decorateTree(document.body);

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === 'characterData') decorateTextNode(record.target);
      else record.addedNodes.forEach(decorateTree);
    });
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
})();
