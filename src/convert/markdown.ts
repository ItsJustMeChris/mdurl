import { parseHTML } from 'linkedom';
import { markdownTable } from 'markdown-table';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { appendLinksTable, rewriteLinksInElement } from './links.js';
import type { MarkdownResult } from '../types.js';

type TableAlignment = 'l' | 'c' | 'r' | '';

interface ParsedTableCell {
  align: TableAlignment;
  header: boolean;
  markdown: string;
}

interface ParsedTableRow {
  cells: ParsedTableCell[];
  element: Element;
}

export function htmlToMarkdown(
  html: string,
  baseUrl: string,
  options: { includeLinks: boolean },
): MarkdownResult {
  const { document } = parseHTML(`<main>${html}</main>`);
  const root = document.querySelector('main');
  if (root) {
    preserveMathInElement(root);
  }
  const rewritten = root ? rewriteLinksInElement(root, baseUrl) : { html, links: [] };
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  turndown.use(gfm);
  turndown.remove(['script', 'style', 'template']);
  turndown.addRule('preservedMath', {
    filter: (node) => node.nodeType === 1 && (node as Element).hasAttribute('data-mdurl-math'),
    replacement: (_content, node) => {
      const element = node as Element;
      const tex = decodeURIComponent(element.getAttribute('data-mdurl-tex') ?? '');
      return element.getAttribute('data-mdurl-math') === 'display'
        ? `\n\n$$\n${tex}\n$$\n\n`
        : `$${tex}$`;
    },
  });
  turndown.addRule('ariaHeading', {
    filter: (node) => node.nodeType === 1 && isAriaHeading(node as Element),
    replacement: (content, node) => {
      const heading = content.trim();
      return heading ? `\n\n${'#'.repeat(headingLevel(node as Element))} ${heading}\n\n` : '';
    },
  });
  turndown.addRule('fencedCodeBlock', {
    filter: (node) => node.nodeName === 'PRE',
    replacement: (_content, node) => codeBlockToMarkdown(node as Element),
  });
  turndown.addRule('stripEmptyLinks', {
    filter: (node) => node.nodeName === 'A' && !(node.textContent ?? '').trim(),
    replacement: () => '',
  });
  turndown.addRule('markdownTables', {
    filter: (node) => node.nodeName === 'TABLE',
    replacement: (_content, node) => tableToMarkdown(node as Element, turndown),
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
  return `${promoteCodeLanguageLabels(markdown)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

function preserveMathInElement(root: ParentNode): void {
  for (const script of Array.from(root.querySelectorAll('script[type^="math/tex"]'))) {
    const tex = script.textContent?.trim();
    if (!tex) {
      continue;
    }

    replaceWithMath(script, tex, /mode\s*=\s*display/i.test(script.getAttribute('type') ?? ''));
  }

  for (const katex of Array.from(root.querySelectorAll('.katex'))) {
    const tex = mathAnnotation(katex);
    if (tex) {
      replaceWithMath(katex, tex, Boolean(katex.closest('.katex-display')));
    }
  }

  for (const math of Array.from(root.querySelectorAll('math'))) {
    const tex = mathAnnotation(math);
    if (tex) {
      replaceWithMath(math, tex, Boolean(math.closest('.katex-display, [display="block"]')));
    }
  }
}

function mathAnnotation(math: Element): string | undefined {
  const annotation = Array.from(math.querySelectorAll('annotation')).find((element) =>
    /(?:x-tex|x-latex|tex|latex)$/i.test(element.getAttribute('encoding') ?? ''),
  );
  return annotation?.textContent?.trim() || undefined;
}

function replaceWithMath(element: Element, tex: string, display: boolean): void {
  const replacement = element.ownerDocument.createElement(display ? 'div' : 'span');
  replacement.setAttribute('data-mdurl-math', display ? 'display' : 'inline');
  replacement.setAttribute('data-mdurl-tex', encodeURIComponent(tex));
  replacement.textContent = display ? `$$\n${tex}\n$$` : `$${tex}$`;
  element.replaceWith(replacement);
}

function promoteCodeLanguageLabels(markdown: string): string {
  return markdown.replace(/\n\n([A-Za-z][\w#+.-]{0,30})\n\n```/g, (match, language: string) => {
    const normalized = normalizeLanguageLabel(language);
    return normalized ? `\n\n\`\`\`${normalized}` : match;
  });
}

function normalizeLanguageLabel(language: string): string | undefined {
  const normalized = language.trim().toLowerCase();
  const aliases: Record<string, string> = {
    'c++': 'cpp',
    'c#': 'csharp',
    shell: 'sh',
    javascript: 'js',
    typescript: 'ts',
  };
  const allowed = new Set([
    'bash',
    'c',
    'clojure',
    'cpp',
    'csharp',
    'css',
    'diff',
    'go',
    'graphql',
    'html',
    'http',
    'java',
    'js',
    'json',
    'jsx',
    'kotlin',
    'php',
    'python',
    'ruby',
    'rust',
    'scss',
    'sh',
    'sql',
    'swift',
    'toml',
    'ts',
    'tsx',
    'xml',
    'yaml',
    'yml',
  ]);
  const aliased = aliases[normalized] ?? normalized;

  return allowed.has(aliased) ? aliased : undefined;
}

function codeBlockToMarkdown(node: Element): string {
  const language = codeLanguage(node);
  const code = codeBlockText(node);
  const fence = codeFenceFor(code);

  return `\n\n${fence}${language ?? ''}\n${code}\n${fence}\n\n`;
}

function codeBlockText(pre: Element): string {
  const code = pre.querySelector('code') ?? pre;
  const lineElements = codeLineElements(code);

  if (lineElements.length > 1) {
    return lineElements.map(codeLineText).join('\n').replace(/\n$/u, '');
  }

  return normalizeCodeText(code.textContent ?? '');
}

function codeLineElements(root: Element): Element[] {
  const directLines = Array.from(root.children).filter(isCodeLineElement);
  if (directLines.length > 1) {
    return directLines;
  }

  return outermostElements(
    Array.from(root.querySelectorAll('[data-line], [data-line-number], .line, .code-line, .highlight-line')).filter(
      isCodeLineElement,
    ),
  );
}

function outermostElements(elements: Element[]): Element[] {
  const elementSet = new Set(elements);
  return elements.filter((element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (elementSet.has(parent)) {
        return false;
      }
    }

    return true;
  });
}

function isCodeLineElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  const className = element.getAttribute('class') ?? '';

  return (
    element.hasAttribute('data-line') ||
    element.hasAttribute('data-line-number') ||
    /\b(?:line|code-line|highlight-line)\b/i.test(className) ||
    tagName === 'div' ||
    tagName === 'p'
  );
}

function codeLineText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const node of Array.from(
    clone.querySelectorAll('[aria-hidden="true"], .line-number, .lineno, .line-numbers-rows'),
  )) {
    node.remove();
  }

  return normalizeCodeText(clone.textContent ?? '').replace(/^\n+|\n+$/gu, '');
}

function normalizeCodeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\n$/u, '');
}

function isAriaHeading(element: Element): boolean {
  return element.getAttribute('role') === 'heading' && !/^H[1-6]$/i.test(element.tagName);
}

function headingLevel(element: Element): number {
  const level = Number.parseInt(element.getAttribute('aria-level') ?? '', 10);
  if (Number.isFinite(level)) {
    return Math.min(Math.max(level, 1), 6);
  }

  return 2;
}

function codeLanguage(pre: Element): string | undefined {
  const code = pre.querySelector('code');
  const candidates = [
    code?.getAttribute('data-language'),
    code?.getAttribute('lang'),
    code?.getAttribute('class'),
    pre.getAttribute('data-language'),
    pre.getAttribute('lang'),
    pre.getAttribute('class'),
  ];

  for (const candidate of candidates) {
    const language = languageFromAttribute(candidate);
    if (language) {
      return language;
    }
  }

  return undefined;
}

function languageFromAttribute(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const direct = normalizeLanguageLabel(value);
  if (direct) {
    return direct;
  }

  const match = value.match(
    /(?:^|\s)(?:language-|lang-|brush:\s*|highlight-source-|sourceCode\s+|shiki\s+language-)([A-Za-z][\w#+.-]{0,30})/i,
  );
  return match ? normalizeLanguageLabel(match[1]) : undefined;
}

function codeFenceFor(code: string): string {
  const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(longest + 1);
}

function isRowHeaderTable(node: Element): boolean {
  if (node.nodeName !== 'TABLE' || node.querySelector('thead')) {
    return false;
  }

  const rows = tableRows(node);
  return rows.length > 0 && rows.every((row) => row.length >= 2 && row[0]?.nodeName === 'TH');
}

function tableToMarkdown(table: Element, turndown: TurndownService): string {
  const rows = parsedTableRows(table, turndown);
  const maxColumns = Math.max(0, ...rows.map((row) => row.cells.length));
  if (maxColumns === 0 || rows.every((row) => row.cells.every((cell) => !cell.markdown))) {
    return '';
  }

  const headingRow = isHeadingTableRow(rows[0]) ? rows[0] : undefined;
  const bodyRows = headingRow ? rows.slice(1) : rows;
  const heading = headingRow
    ? padRow(headingRow.cells, maxColumns).map((cell, index) => cell.markdown || `Column ${index + 1}`)
    : generatedTableHeading(maxColumns);
  const body = bodyRows.map((row) => padRow(row.cells, maxColumns).map((cell) => cell.markdown));
  const align = columnAlignments(rows, maxColumns);
  const caption = tableCaption(table, turndown);
  const rendered = markdownTable([heading, ...body], {
    align,
    alignDelimiters: false,
  });

  return `\n\n${caption ? `${caption}\n\n` : ''}${rendered}\n\n`;
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

function parsedTableRows(table: Element, turndown: TurndownService): ParsedTableRow[] {
  const pendingRowspans: Array<{ remaining: number; cell: ParsedTableCell } | undefined> = [];

  return tableRowElements(table)
    .map((rowElement) => {
      const cells: ParsedTableCell[] = [];
      let columnIndex = 0;

      const flushPendingCell = () => {
        const pending = pendingRowspans[columnIndex];
        if (!pending || pending.remaining <= 0) {
          return false;
        }

        cells[columnIndex] = pending.cell;
        pending.remaining -= 1;
        if (pending.remaining === 0) {
          pendingRowspans[columnIndex] = undefined;
        }
        columnIndex += 1;
        return true;
      };

      for (const cellElement of tableRowCells(rowElement)) {
        while (flushPendingCell()) {
          // Keep rowspanned cells in their original columns before adding the next explicit cell.
        }

        const parsed = parsedTableCell(cellElement, turndown);
        const colspan = span(cellElement, 'colspan');
        const rowspan = span(cellElement, 'rowspan');

        for (let spanIndex = 0; spanIndex < colspan; spanIndex += 1) {
          const cell = spanIndex === 0 ? parsed : { ...parsed, markdown: '' };
          cells[columnIndex] = cell;
          if (rowspan > 1) {
            pendingRowspans[columnIndex] = { remaining: rowspan - 1, cell };
          }
          columnIndex += 1;
        }
      }

      while (columnIndex < pendingRowspans.length) {
        if (!flushPendingCell()) {
          columnIndex += 1;
        }
      }

      return { cells, element: rowElement };
    })
    .filter((row) => row.cells.length > 0);
}

function tableRows(table: Element): Element[][] {
  return tableRowElements(table)
    .map((row) => tableRowCells(row))
    .filter((row) => row.length > 0);
}

function tableRowElements(table: Element): Element[] {
  const rows: Element[] = [];

  for (const child of Array.from(table.children)) {
    const tagName = child.tagName.toLowerCase();
    if (tagName === 'tr') {
      rows.push(child);
    } else if (tagName === 'thead' || tagName === 'tbody' || tagName === 'tfoot') {
      rows.push(
        ...Array.from(child.children).filter((element) => element.tagName.toLowerCase() === 'tr'),
      );
    }
  }

  return rows;
}

function tableRowCells(row: Element): Element[] {
  return Array.from(row.children).filter((cell) => cell.nodeName === 'TH' || cell.nodeName === 'TD');
}

function parsedTableCell(cell: Element, turndown: TurndownService): ParsedTableCell {
  return {
    align: cellAlignment(cell),
    header: cell.nodeName === 'TH',
    markdown: tableCellMarkdown(cell, turndown),
  };
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

function tableCellMarkdown(cell: Element, turndown: TurndownService): string {
  return escapeTableCell(
    turndown
      .turndown(cell.innerHTML)
      .replace(/\r\n/g, '\n')
      .replace(/\n{2,}/g, '<br>')
      .replace(/\n/g, '<br>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*<br>\s*/g, '<br>')
      .trim(),
  );
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function isHeadingTableRow(row: ParsedTableRow | undefined): boolean {
  if (!row || row.cells.length === 0) {
    return false;
  }

  return row.element.parentElement?.tagName.toLowerCase() === 'thead' || row.cells.every((cell) => cell.header);
}

function padRow(cells: ParsedTableCell[], columns: number): ParsedTableCell[] {
  return Array.from({ length: columns }, (_, index) => cells[index] ?? emptyTableCell());
}

function emptyTableCell(): ParsedTableCell {
  return { align: '', header: false, markdown: '' };
}

function generatedTableHeading(columns: number): string[] {
  return Array.from({ length: columns }, (_, index) => `Column ${index + 1}`);
}

function columnAlignments(rows: ParsedTableRow[], columns: number): TableAlignment[] {
  return Array.from({ length: columns }, (_, index) => {
    for (const row of rows) {
      const align = row.cells[index]?.align;
      if (align) {
        return align;
      }
    }

    return '';
  });
}

function cellAlignment(cell: Element): TableAlignment {
  const align = (cell.getAttribute('align') ?? '').toLowerCase();
  if (align === 'left' || align === 'l') {
    return 'l';
  }
  if (align === 'center' || align === 'middle' || align === 'c') {
    return 'c';
  }
  if (align === 'right' || align === 'r') {
    return 'r';
  }

  const style = cell.getAttribute('style') ?? '';
  const styleAlign = style.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right)\b/i)?.[1]?.toLowerCase();
  if (styleAlign === 'left') {
    return 'l';
  }
  if (styleAlign === 'center') {
    return 'c';
  }
  if (styleAlign === 'right') {
    return 'r';
  }

  return '';
}

function span(cell: Element, attribute: 'colspan' | 'rowspan'): number {
  const value = Number.parseInt(cell.getAttribute(attribute) ?? '', 10);
  return Number.isFinite(value) && value > 1 ? Math.min(value, 100) : 1;
}

function tableCaption(table: Element, turndown: TurndownService): string | undefined {
  const caption = Array.from(table.children).find((child) => child.tagName.toLowerCase() === 'caption');
  if (!caption) {
    return undefined;
  }

  const markdown = cellMarkdown(caption, turndown);
  return markdown ? `**${markdown}**` : undefined;
}
