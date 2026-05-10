import { parseHTML } from 'linkedom';
import type {
  PageEmbedReference,
  PageFormField,
  PageFormReference,
  PageHeadingReference,
  PageImageReference,
  PageLinkReference,
  PagePaginationReference,
  PageResources,
} from '../types.js';

const NON_RENDERED_RESOURCE_SELECTORS = [
  'script',
  'style',
  'template',
  'noscript',
  '[hidden]',
  '[aria-hidden="true"]',
  '[style*="display:none"]',
  '[style*="display: none"]',
].join(',');

export function emptyPageResources(): PageResources {
  return {
    headings: [],
    pagination: [],
    links: [],
    images: [],
    forms: [],
    embeds: [],
  };
}

export function extractPageResources(html: string, baseUrl: string): PageResources {
  const { document } = parseHTML(html);
  return extractPageResourcesFromDocument(document, baseUrl);
}

export function extractPageResourcesFromDocument(document: Document, baseUrl: string): PageResources {
  if (!document.documentElement) {
    return emptyPageResources();
  }

  const resourceDocument = document.cloneNode(true) as Document;
  removeNonRenderedResourceNodes(resourceDocument);

  return {
    headings: extractHeadings(resourceDocument, baseUrl),
    pagination: extractPagination(resourceDocument, baseUrl),
    links: extractLinks(resourceDocument, baseUrl),
    images: extractImages(resourceDocument, baseUrl),
    forms: extractForms(resourceDocument, baseUrl),
    embeds: extractEmbeds(resourceDocument, baseUrl),
  };
}

function removeNonRenderedResourceNodes(document: Document): void {
  for (const element of Array.from(document.querySelectorAll(NON_RENDERED_RESOURCE_SELECTORS))) {
    element.remove();
  }
}

export function appendPageResources(markdown: string, resources: PageResources): string {
  if (
    resources.links.length === 0 &&
    resources.images.length === 0 &&
    resources.forms.length === 0 &&
    resources.embeds.length === 0 &&
    resources.headings.length === 0 &&
    resources.pagination.length === 0
  ) {
    return markdown;
  }

  const sections = ['## Page Resources', ''];
  const navigationLinks = resources.links.filter((link) => isNavigationalContext(link.context));

  if (navigationLinks.length > 0) {
    sections.push(
      '### Navigation',
      '',
      '| # | Area | Text | URL |',
      '|---:|---|---|---|',
      ...navigationLinks.map(
        (link) =>
          `| ${link.index} | ${escapeTableCell(link.context)} | ${escapeTableCell(link.text)} | ${escapeTableCell(link.url)} |`,
      ),
      '',
    );
  }

  if (resources.headings.length > 0) {
    sections.push(
      '### Table of Contents',
      '',
      '| # | Level | Text | URL |',
      '|---:|---:|---|---|',
      ...resources.headings.map(
        (heading) =>
          `| ${heading.index} | ${heading.level} | ${escapeTableCell(heading.text)} | ${escapeTableCell(heading.url ?? '')} |`,
      ),
      '',
    );
  }

  if (resources.pagination.length > 0) {
    sections.push(
      '### Pagination',
      '',
      '| # | Rel | Text | URL |',
      '|---:|---|---|---|',
      ...resources.pagination.map(
        (link) =>
          `| ${link.index} | ${link.rel} | ${escapeTableCell(link.text)} | ${escapeTableCell(link.url)} |`,
      ),
      '',
    );
  }

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
      '| # | Context | Label | Source | URL | Linked URL |',
      '|---:|---|---|---|---|---|',
      ...resources.images.map(
        (image) =>
          `| ${image.index} | ${escapeTableCell(image.context)} | ${escapeTableCell(image.label)} | ${image.source} | ${escapeTableCell(image.url)} | ${escapeTableCell(image.linked_url ?? '')} |`,
      ),
      '',
    );
  }

  if (resources.forms.length > 0) {
    sections.push('### Forms', '');

    for (const form of resources.forms) {
      sections.push(
        `#### ${form.index}. ${form.label}`,
        '',
        `- **Context:** ${form.context}`,
        `- **Method:** ${form.method.toUpperCase()}`,
        `- **Action:** ${form.action}`,
      );

      if (form.fields.length > 0) {
        sections.push(
          '',
          '| Field | Type | Required | Label / Placeholder | Value / Options |',
          '|---|---|---:|---|---|',
          ...form.fields.map(
            (field) =>
              `| ${escapeTableCell(field.name ?? '')} | ${escapeTableCell(field.type)} | ${field.required ? 'yes' : ''} | ${escapeTableCell(field.label || field.placeholder || '')} | ${escapeTableCell(field.options?.join(', ') || field.value || '')} |`,
          ),
        );
      }

      if (form.buttons.length > 0) {
        sections.push('', `- **Buttons:** ${form.buttons.map(escapeInline).join(', ')}`);
      }

      sections.push('');
    }
  }

  if (resources.embeds.length > 0) {
    sections.push(
      '### Embeds',
      '',
      '| # | Context | Type | Label | URL | Size |',
      '|---:|---|---|---|---|---|',
      ...resources.embeds.map(
        (embed) =>
          `| ${embed.index} | ${escapeTableCell(embed.context)} | ${embed.type} | ${escapeTableCell(embed.label)} | ${escapeTableCell(embed.url)} | ${escapeTableCell([embed.width, embed.height].filter(Boolean).join('x'))} |`,
      ),
      '',
    );
  }

  return `${markdown.trimEnd()}\n\n${sections.join('\n').trimEnd()}\n`;
}

function extractHeadings(document: Document, baseUrl: string): PageHeadingReference[] {
  return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))
    .map((heading) => ({
      level: headingLevel(heading),
      text: normalizeText(heading.textContent ?? ''),
      url: headingUrl(heading, baseUrl),
    }))
    .filter((heading) => heading.text)
    .map((heading, index) => ({ ...heading, index: index + 1 }));
}

function headingLevel(heading: Element): number {
  const tagName = heading.tagName.toLowerCase();
  if (/^h[1-6]$/u.test(tagName)) {
    return Number.parseInt(tagName.slice(1), 10);
  }

  const ariaLevel = Number.parseInt(heading.getAttribute('aria-level') ?? '', 10);
  if (Number.isFinite(ariaLevel)) {
    return Math.min(Math.max(ariaLevel, 1), 6);
  }

  return 2;
}

function extractPagination(document: Document, baseUrl: string): PagePaginationReference[] {
  const pagination: Omit<PagePaginationReference, 'index'>[] = [];
  const seen = new Set<string>();

  for (const element of Array.from(document.querySelectorAll('a[href][rel], link[href][rel]'))) {
    const rel = paginationRel(element.getAttribute('rel') ?? '');
    const href = element.getAttribute('href');
    if (!rel || !href) {
      continue;
    }

    const url = absolutize(href, baseUrl);
    if (shouldSkipUrl(url) || seen.has(`${rel}\u0000${url}`)) {
      continue;
    }

    seen.add(`${rel}\u0000${url}`);
    pagination.push({
      rel,
      text: normalizeText(element.textContent ?? '') || normalizeText(element.getAttribute('title') ?? '') || rel,
      url,
    });
  }

  return pagination.map((link, index) => ({ ...link, index: index + 1 }));
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
    const candidate = imageCandidate(image);
    if (!candidate) {
      continue;
    }

    pushImage(images, seen, {
      element: image,
      url: candidate.url,
      baseUrl,
      source: candidate.source,
      label: labelForImage(image),
      linkedUrl: closestLinkUrl(image, baseUrl),
    });
  }

  for (const source of Array.from(document.querySelectorAll('picture source, source[type^="image/"]'))) {
    const srcset = source.getAttribute('srcset') || source.getAttribute('data-srcset');
    const url = bestSrcsetUrl(srcset);
    if (!url) {
      continue;
    }

    const picture = source.closest('picture');
    const image = picture?.querySelector('img');
    pushImage(images, seen, {
      element: source,
      url,
      baseUrl,
      source: source.getAttribute('srcset') ? 'source' : 'data',
      label: image ? labelForImage(image) : labelForElement(source) || 'picture source',
      linkedUrl: image ? closestLinkUrl(image, baseUrl) : undefined,
    });
  }

  for (const link of Array.from(document.querySelectorAll('link[href]'))) {
    const rel = normalizeText(link.getAttribute('rel') ?? '');
    const as = normalizeText(link.getAttribute('as') ?? '');
    if (!/\b(icon|apple-touch-icon|mask-icon)\b/i.test(rel) && !(rel === 'preload' && as === 'image')) {
      continue;
    }

    pushImage(images, seen, {
      element: link,
      url: link.getAttribute('href') || bestSrcsetUrl(link.getAttribute('imagesrcset')) || '',
      baseUrl,
      source: 'icon',
      label: rel === 'preload' ? 'preloaded image' : rel || 'site icon',
      context: 'metadata',
    });
  }

  for (const meta of Array.from(document.querySelectorAll('meta[content]'))) {
    const name = normalizeText(meta.getAttribute('property') || meta.getAttribute('name') || '');
    if (!/^(og:image|twitter:image|twitter:image:src|image|thumbnail|thumbnailurl|msapplication-.*logo)$/i.test(name)) {
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

function extractForms(document: Document, baseUrl: string): PageFormReference[] {
  return Array.from(document.querySelectorAll('form')).map((form, index) => {
    const action = form.getAttribute('action') || document.URL || baseUrl;
    return {
      index: index + 1,
      context: contextFor(form),
      label: labelForForm(form, index + 1),
      action: absolutize(action, baseUrl),
      method: normalizeText(form.getAttribute('method') || 'get').toLowerCase(),
      fields: extractFormFields(form),
      buttons: extractFormButtons(form),
    };
  });
}

function extractFormFields(form: Element): PageFormField[] {
  const fields: PageFormField[] = [];

  for (const field of Array.from(form.querySelectorAll('input, textarea, select'))) {
    const tag = field.tagName.toLowerCase();
    const inputType = normalizeText(field.getAttribute('type') || tag).toLowerCase();
    if (inputType === 'submit' || inputType === 'button' || inputType === 'reset' || inputType === 'image') {
      continue;
    }

    const name = normalizeText(field.getAttribute('name') || field.getAttribute('id') || '');
    const type = tag === 'input' ? inputType : tag;
    const options = tag === 'select' ? selectOptions(field) : undefined;

    fields.push({
      name: name || undefined,
      type,
      label: labelForField(field) || undefined,
      required: field.hasAttribute('required') || undefined,
      placeholder: normalizeText(field.getAttribute('placeholder') || '') || undefined,
      value: normalizeText(field.getAttribute('value') || '') || undefined,
      options: options && options.length > 0 ? options : undefined,
    });
  }

  return fields;
}

function extractFormButtons(form: Element): string[] {
  return Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="reset"]'))
    .map((button) =>
      normalizeText(button.textContent || button.getAttribute('value') || button.getAttribute('aria-label') || ''),
    )
    .filter(Boolean);
}

function extractEmbeds(document: Document, baseUrl: string): PageEmbedReference[] {
  const embeds: Omit<PageEmbedReference, 'index'>[] = [];
  const seen = new Set<string>();

  for (const element of Array.from(document.querySelectorAll('iframe[src], embed[src], object[data], video[src], audio[src], video source[src], audio source[src]'))) {
    const type = embedType(element);
    const rawUrl = element.getAttribute('src') || element.getAttribute('data');
    if (!rawUrl) {
      continue;
    }

    const url = absolutize(rawUrl, baseUrl);
    if (shouldSkipUrl(url) || seen.has(`${type}\u0000${url}`)) {
      continue;
    }

    seen.add(`${type}\u0000${url}`);
    embeds.push({
      context: contextFor(element),
      label: labelForEmbed(element, type),
      url,
      type,
      width: normalizeText(element.getAttribute('width') || '') || undefined,
      height: normalizeText(element.getAttribute('height') || '') || undefined,
    });
  }

  return embeds.map((embed, index) => ({ ...embed, index: index + 1 }));
}

function labelForForm(form: Element, index: number): string {
  return (
    normalizeText(form.getAttribute('aria-label') || '') ||
    normalizeText(form.getAttribute('name') || form.getAttribute('id') || '') ||
    `${contextFor(form)} form ${index}`
  );
}

function labelForField(field: Element): string {
  const id = field.getAttribute('id');
  const document = field.ownerDocument;
  const explicitLabel = id ? document.querySelector(`label[for="${cssEscape(id)}"]`) : undefined;
  const wrappedLabel = field.closest('label');

  return (
    normalizeText(explicitLabel?.textContent ?? '') ||
    normalizeText(wrappedLabel?.textContent ?? '') ||
    normalizeText(field.getAttribute('aria-label') || field.getAttribute('title') || '') ||
    normalizeText(field.getAttribute('placeholder') || '')
  );
}

function selectOptions(select: Element): string[] {
  return Array.from(select.querySelectorAll('option'))
    .map((option) => normalizeText(option.textContent || option.getAttribute('value') || ''))
    .filter(Boolean)
    .slice(0, 20);
}

function embedType(element: Element): PageEmbedReference['type'] {
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'source') {
    const parent = element.parentElement?.tagName.toLowerCase();
    return parent === 'audio' ? 'audio' : 'video';
  }

  return tagName as PageEmbedReference['type'];
}

function labelForEmbed(element: Element, type: PageEmbedReference['type']): string {
  return (
    normalizeText(element.getAttribute('title') || element.getAttribute('aria-label') || '') ||
    labelForElement(element) ||
    `${type} embed`
  );
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function imageCandidate(image: Element): { url: string; source: PageImageReference['source'] } | undefined {
  for (const attribute of ['data-src', 'data-lazy-src', 'data-original', 'data-original-src', 'data-pin-media']) {
    const value = image.getAttribute(attribute);
    if (value) {
      return { url: value, source: 'data' };
    }
  }

  for (const attribute of ['data-srcset', 'data-lazy-srcset']) {
    const value = bestSrcsetUrl(image.getAttribute(attribute));
    if (value) {
      return { url: value, source: 'data' };
    }
  }

  const src = image.getAttribute('src');
  if (src && !isPlaceholderImage(src)) {
    return { url: src, source: 'img' };
  }

  const srcset = bestSrcsetUrl(image.getAttribute('srcset'));
  if (srcset) {
    return { url: srcset, source: 'srcset' };
  }

  return undefined;
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
    labelFromUrl(url) ||
    url
  );
}

function labelFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const segment = url.pathname.split('/').filter(Boolean).at(-1) || url.hostname;
    const label = segment
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
    return normalizeText(label) || undefined;
  } catch {
    return undefined;
  }
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

function headingUrl(heading: Element, baseUrl: string): string | undefined {
  const id = heading.getAttribute('id') || heading.querySelector('[id]')?.getAttribute('id');
  if (id) {
    return absolutize(`#${id}`, baseUrl);
  }

  const anchor = heading.querySelector('a[href]');
  const href = anchor?.getAttribute('href');
  return href && href.startsWith('#') ? absolutize(href, baseUrl) : undefined;
}

function bestSrcsetUrl(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const candidates = value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);

  return candidates.at(-1);
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

function isNavigationalContext(context: string): boolean {
  return /(^|\/)(header|navigation|footer|breadcrumb|sidebar|aside|menu|logo)(\/|$)/i.test(context);
}

function paginationRel(value: string): PagePaginationReference['rel'] | undefined {
  const tokens = normalizeText(value).toLowerCase().split(/\s+/);
  if (tokens.includes('next')) {
    return 'next';
  }

  if (tokens.includes('prev') || tokens.includes('previous')) {
    return 'prev';
  }

  return undefined;
}

function isPlaceholderImage(value: string): boolean {
  return /^(data:|about:blank$)/i.test(value) || /(?:placeholder|blank|spacer|transparent)\.(?:gif|png|svg)(?:$|\?)/i.test(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function escapeInline(value: string): string {
  return value.replace(/\n/g, ' ');
}
