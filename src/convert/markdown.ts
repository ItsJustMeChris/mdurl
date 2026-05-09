import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { appendLinksTable, rewriteLinks } from './links.js';
import type { MarkdownResult } from '../types.js';

export function htmlToMarkdown(
  html: string,
  baseUrl: string,
  options: { includeLinks: boolean },
): MarkdownResult {
  const rewritten = rewriteLinks(preserveMath(html), baseUrl);
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
  turndown.addRule('fencedCodeWithLanguage', {
    filter: (node) => isLanguageCodeBlock(node as Element),
    replacement: (_content, node) => codeBlockToMarkdown(node as Element),
  });
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
  return `${promoteCodeLanguageLabels(markdown)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

function preserveMath(html: string): string {
  const { document } = parseHTML(html);

  for (const script of Array.from(document.querySelectorAll('script[type^="math/tex"]'))) {
    const tex = script.textContent?.trim();
    if (!tex) {
      continue;
    }

    replaceWithMath(script, tex, /mode\s*=\s*display/i.test(script.getAttribute('type') ?? ''));
  }

  for (const katex of Array.from(document.querySelectorAll('.katex'))) {
    const tex = mathAnnotation(katex);
    if (tex) {
      replaceWithMath(katex, tex, Boolean(katex.closest('.katex-display')));
    }
  }

  for (const math of Array.from(document.querySelectorAll('math'))) {
    const tex = mathAnnotation(math);
    if (tex) {
      replaceWithMath(math, tex, Boolean(math.closest('.katex-display, [display="block"]')));
    }
  }

  return document.toString();
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

function isLanguageCodeBlock(node: Element): boolean {
  if (node.nodeName !== 'PRE') {
    return false;
  }

  return Boolean(codeLanguage(node));
}

function codeBlockToMarkdown(node: Element): string {
  const language = codeLanguage(node);
  const code = (node.querySelector('code') ?? node).textContent?.replace(/\n$/, '') ?? '';
  const fence = codeFenceFor(code);

  return `\n\n${fence}${language}\n${code}\n${fence}\n\n`;
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
