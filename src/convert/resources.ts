import { parseHTML } from 'linkedom';
import type { PageImageReference, PageLinkReference, PageResources } from '../types.js';

const EMPTY_RESOURCES: PageResources = {
  links: [],
  images: [],
};

export function emptyPageResources(): PageResources {
  return {
    links: [],
    images: [],
  };
}

export function extractPageResources(html: string, baseUrl: string): PageResources {
  const { document } = parseHTML(html);

  if (!document.documentElement) {
    return EMPTY_RESOURCES;
  }

  return {
    links: extractLinks(document, baseUrl),
    images: extractImages(document, baseUrl),
  };
}

export function appendPageResources(markdown: string, resources: PageResources): string {
  if (resources.links.length === 0 && resources.images.length === 0) {
    return markdown;
  }

  const sections = ['## Page Resources', ''];

  if (resources.links.length > 0) {
    sections.push(
      '### Links',
      '',
      '| # | Context | Text | URL |',
      '|---:|---|---|---|',
      ...resources.links.map(
        (link) =>
          `| ${link.index} | ${escapeTableCell(link.context)} | ${escapeTableCell(link.text)} | ${escapeTableCell(link.url)} |`,
      ),
      '',
    );
  }

  if (resources.images.length > 0) {
    sections.push(
      '### Images',
      '',
      '| # | Context | Label | URL | Linked URL |',
      '|---:|---|---|---|---|',
      ...resources.images.map(
        (image) =>
          `| ${image.index} | ${escapeTableCell(image.context)} | ${escapeTableCell(image.label)} | ${escapeTableCell(image.url)} | ${escapeTableCell(image.linked_url ?? '')} |`,
      ),
      '',
    );
  }

  return `${markdown.trimEnd()}\n\n${sections.join('\n').trimEnd()}\n`;
}

function extractLinks(document: Document, baseUrl: string): PageLinkReference[] {
  const links: PageLinkReference[] = [];
  const seen = new Set<string>();

  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href');
    if (!href) {
      continue;
    }

    const url = absolutize(href, baseUrl);
    if (shouldSkipUrl(url)) {
      continue;
    }

    const context = contextFor(anchor);
    const text = labelForLink(anchor, url);
    const key = `${context}\u0000${text}\u0000${url}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    links.push({
      index: links.length + 1,
      context,
      text,
      url,
    });
  }

  return links;
}

function extractImages(document: Document, baseUrl: string): PageImageReference[] {
  const images: Omit<PageImageReference, 'index'>[] = [];
  const seen = new Set<string>();

  for (const image of Array.from(document.querySelectorAll('img'))) {
    const src = image.getAttribute('src') || firstSrcsetUrl(image.getAttribute('srcset'));
    if (!src) {
      continue;
    }

    pushImage(images, seen, {
      element: image,
      url: src,
      baseUrl,
      source: image.getAttribute('src') ? 'img' : 'srcset',
      label: labelForImage(image),
      linkedUrl: closestLinkUrl(image, baseUrl),
    });
  }

  for (const link of Array.from(document.querySelectorAll('link[href]'))) {
    const rel = normalizeText(link.getAttribute('rel') ?? '');
    if (!/\b(icon|apple-touch-icon|mask-icon)\b/i.test(rel)) {
      continue;
    }

    pushImage(images, seen, {
      element: link,
      url: link.getAttribute('href') ?? '',
      baseUrl,
      source: 'icon',
      label: rel || 'site icon',
      context: 'metadata',
    });
  }

  for (const meta of Array.from(document.querySelectorAll('meta[content]'))) {
    const name = normalizeText(meta.getAttribute('property') || meta.getAttribute('name') || '');
    if (!/^(og:image|twitter:image|twitter:image:src)$/i.test(name)) {
      continue;
    }

    pushImage(images, seen, {
      element: meta,
      url: meta.getAttribute('content') ?? '',
      baseUrl,
      source: 'meta',
      label: name,
      context: 'metadata',
    });
  }

  for (const element of Array.from(document.querySelectorAll('[style*="url"]'))) {
    for (const url of inlineStyleUrls(element.getAttribute('style') ?? '')) {
      pushImage(images, seen, {
        element,
        url,
        baseUrl,
        source: 'style',
        label: labelForElement(element) || 'inline background image',
      });
    }
  }

  return images.map((image, index) => ({ ...image, index: index + 1 }));
}

function pushImage(
  images: Omit<PageImageReference, 'index'>[],
  seen: Set<string>,
  input: {
    element: Element;
    url: string;
    baseUrl: string;
    source: PageImageReference['source'];
    label: string;
    context?: string;
    linkedUrl?: string;
  },
): void {
  const url = absolutize(input.url, input.baseUrl);
  if (shouldSkipUrl(url)) {
    return;
  }

  const context = input.context ?? contextFor(input.element);
  const label = maybeLogoLabel(input.label, input.element, url, context);
  const key = `${context}\u0000${label}\u0000${url}\u0000${input.linkedUrl ?? ''}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  images.push({
    context,
    label,
    url,
    linked_url: input.linkedUrl,
    source: input.source,
  });
}

function contextFor(element: Element): string {
  const contextElement = element.closest('header, nav, main, article, aside, footer');
  const structuralContext = contextElement?.tagName.toLowerCase();
  const signature = ancestorSignature(element, contextElement);

  if (/\blogo\b/i.test(signature)) {
    return structuralContext ? `${structuralContext}/logo` : 'logo';
  }

  if (structuralContext === 'nav' || /\b(nav|navigation|menu|top-menu|mobile_menu)\b/i.test(signature)) {
    return 'navigation';
  }

  if (/\b(header|masthead|main-header|top-header|et-top-navigation)\b/i.test(signature)) {
    return 'header';
  }

  if (/\b(footer|bottom)\b/i.test(signature)) {
    return 'footer';
  }

  if (structuralContext) {
    return structuralContext;
  }

  return 'page';
}

function ancestorSignature(element: Element, contextElement?: Element | null): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 6) {
    parts.push(current.tagName.toLowerCase(), current.getAttribute('id') ?? '', current.getAttribute('class') ?? '');

    if (current === contextElement) {
      break;
    }

    current = current.parentElement;
    depth += 1;
  }

  if (contextElement && !parts.includes(contextElement.tagName.toLowerCase())) {
    parts.push(
      contextElement.tagName.toLowerCase(),
      contextElement.getAttribute('id') ?? '',
      contextElement.getAttribute('class') ?? '',
    );
  }

  return parts.join(' ');
}

function labelForLink(anchor: Element, url: string): string {
  const imageLabel = anchor.querySelector('img') ? labelForImage(anchor.querySelector('img') as Element) : '';
  return (
    normalizeText(anchor.textContent ?? '') ||
    normalizeText(anchor.getAttribute('aria-label') ?? '') ||
    normalizeText(anchor.getAttribute('title') ?? '') ||
    imageLabel ||
    url
  );
}

function labelForImage(image: Element): string {
  return (
    normalizeText(image.getAttribute('alt') ?? '') ||
    normalizeText(image.getAttribute('aria-label') ?? '') ||
    normalizeText(image.getAttribute('title') ?? '') ||
    labelForElement(image) ||
    '(unlabeled image)'
  );
}

function labelForElement(element: Element): string {
  const id = normalizeText(element.getAttribute('id') ?? '');
  const className = normalizeText(element.getAttribute('class') ?? '');
  return [id, className].filter(Boolean).join(' ');
}

function maybeLogoLabel(label: string, element: Element, url: string, context: string): string {
  const signature = `${label} ${url} ${context} ${element.getAttribute('id') ?? ''} ${element.getAttribute('class') ?? ''}`;
  if (/\blogo\b/i.test(signature) && !/^\[logo\]/i.test(label)) {
    return `[logo] ${label}`;
  }

  return label;
}

function closestLinkUrl(element: Element, baseUrl: string): string | undefined {
  const anchor = element.closest('a[href]');
  const href = anchor?.getAttribute('href');
  return href ? absolutize(href, baseUrl) : undefined;
}

function firstSrcsetUrl(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .find(Boolean);
}

function inlineStyleUrls(value: string): string[] {
  const urls: string[] = [];
  const pattern = /url\((['"]?)(.*?)\1\)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match[2]) {
      urls.push(match[2]);
    }
  }

  return urls;
}

function absolutize(value: string, baseUrl: string): string {
  if (/^(mailto|tel):/i.test(value)) {
    return value;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function shouldSkipUrl(value: string): boolean {
  return /^(javascript:|data:|blob:|about:)/i.test(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
