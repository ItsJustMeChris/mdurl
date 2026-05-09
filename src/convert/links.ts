import { parseHTML } from 'linkedom';
import type { LinkReference } from '../types.js';

export function rewriteLinks(html: string, baseUrl: string): { html: string; links: LinkReference[] } {
  const { document } = parseHTML(`<main>${html}</main>`);
  const root = document.querySelector('main');
  const links: LinkReference[] = [];
  const seen = new Set<string>();

  if (!root) {
    return { html, links };
  }

  for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
    const rawHref = anchor.getAttribute('href');
    if (!rawHref) {
      continue;
    }

    const absoluteUrl = absolutize(rawHref, baseUrl);
    anchor.setAttribute('href', absoluteUrl);

    if (/^javascript:/i.test(absoluteUrl) || seen.has(absoluteUrl)) {
      continue;
    }

    seen.add(absoluteUrl);
    links.push({
      index: links.length + 1,
      text: normalizeText(anchor.textContent ?? absoluteUrl),
      url: absoluteUrl,
    });
  }

  return {
    html: root.innerHTML,
    links,
  };
}

export function appendLinksTable(markdown: string, links: LinkReference[]): string {
  if (links.length === 0) {
    return markdown;
  }

  const rows = [
    '## Links',
    '',
    '| # | Text | URL |',
    '|---:|---|---|',
    ...links.map((link) => `| ${link.index} | ${escapeTableCell(link.text)} | ${escapeTableCell(link.url)} |`),
  ];

  return `${markdown.trimEnd()}\n\n${rows.join('\n')}\n`;
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || '(untitled)';
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
