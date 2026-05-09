import { parseHTML } from 'linkedom';

const REMOVE_SELECTORS = [
  'script',
  'style',
  'template',
  'noscript',
  'svg',
  'iframe',
  'nav',
  'aside',
  'form',
  '[hidden]',
  '[aria-hidden="true"]',
  '[style*="display:none"]',
  '[style*="display: none"]',
];

export function cleanHtml(html: string, baseUrl: string, selector?: string): { html: string; textContent: string; title?: string; lang?: string } {
  const { document } = parseHTML(html);
  const scoped = selector ? document.querySelector(selector) : document.body;

  if (!scoped) {
    throw new Error(`Selector did not match: ${selector}`);
  }

  const root = scoped.cloneNode(true) as HTMLElement;

  for (const node of Array.from(root.querySelectorAll(REMOVE_SELECTORS.join(',')))) {
    node.remove();
  }

  normalizeResourceUrls(root, baseUrl);

  return {
    html: root.outerHTML,
    textContent: (root.textContent ?? '').replace(/\s+/g, ' ').trim(),
    title: document.querySelector('title')?.textContent?.trim() || undefined,
    lang: document.documentElement.getAttribute('lang') || undefined,
  };
}

export function normalizeResourceUrls(root: ParentNode, baseUrl: string): void {
  for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href');
    if (href) {
      anchor.setAttribute('href', absolutize(href, baseUrl));
    }
  }

  for (const image of Array.from(root.querySelectorAll('img[src]'))) {
    const src = image.getAttribute('src');
    if (src) {
      image.setAttribute('src', absolutize(src, baseUrl));
    }
  }
}

function absolutize(value: string, baseUrl: string): string {
  if (/^(mailto|tel|javascript):/i.test(value)) {
    return value;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}
