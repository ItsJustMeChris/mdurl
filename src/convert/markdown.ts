import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { appendLinksTable, rewriteLinks } from './links.js';
import type { MarkdownResult } from '../types.js';

export function htmlToMarkdown(
  html: string,
  baseUrl: string,
  options: { includeLinks: boolean },
): MarkdownResult {
  const rewritten = rewriteLinks(html, baseUrl);
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  turndown.use(gfm);
  turndown.remove(['script', 'style', 'template']);
  turndown.addRule('stripEmptyLinks', {
    filter: (node) => node.nodeName === 'A' && !(node.textContent ?? '').trim(),
    replacement: () => '',
  });

  let markdown = normalizeMarkdown(turndown.turndown(rewritten.html));

  if (options.includeLinks) {
    markdown = appendLinksTable(markdown, rewritten.links);
  }

  return {
    markdown,
    links: rewritten.links,
  };
}

export function wordCount(markdown: string): number {
  const words = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .match(/\b[\p{L}\p{N}'-]+\b/gu);

  return words?.length ?? 0;
}

function normalizeMarkdown(markdown: string): string {
  return `${markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}
