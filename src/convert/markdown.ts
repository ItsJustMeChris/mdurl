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
  turndown.addRule('rowHeaderTables', {
    filter: (node) => isRowHeaderTable(node as Element),
    replacement: (_content, node) => rowHeaderTableToMarkdown(node as Element, turndown),
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

function isRowHeaderTable(node: Element): boolean {
  if (node.nodeName !== 'TABLE' || node.querySelector('thead')) {
    return false;
  }

  const rows = tableRows(node);
  return rows.length > 0 && rows.every((row) => row.length >= 2 && row[0]?.nodeName === 'TH');
}

function rowHeaderTableToMarkdown(table: Element, turndown: TurndownService): string {
  const rows = tableRows(table);
  if (rows.length === 0) {
    return '';
  }

  const lines = [
    '| Field | Value |',
    '|---|---|',
    ...rows.map((row) => {
      const field = cellMarkdown(row[0], turndown);
      const value = row
        .slice(1)
        .map((cell) => cellMarkdown(cell, turndown))
        .filter(Boolean)
        .join('<br>');
      return `| ${escapeTableCell(field)} | ${escapeTableCell(value)} |`;
    }),
  ];

  return `\n\n${lines.join('\n')}\n\n`;
}

function tableRows(table: Element): Element[][] {
  return Array.from(table.querySelectorAll('tr'))
    .map((row) =>
      Array.from(row.children).filter((cell) => cell.nodeName === 'TH' || cell.nodeName === 'TD'),
    )
    .filter((row) => row.length > 0);
}

function cellMarkdown(cell: Element | undefined, turndown: TurndownService): string {
  if (!cell) {
    return '';
  }

  return turndown
    .turndown(cell.innerHTML)
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
