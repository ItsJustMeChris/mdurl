import { parseHTML } from 'linkedom';
import { MdurlError, normalizeError } from './errors.js';
import { fetchBrowser } from './fetch/browser.js';
import { fetchPlain } from './fetch/plain.js';
import { detectAccessStatus } from './extract/access.js';
import { emptyPageResources } from './convert/resources.js';
import { wordCount } from './convert/markdown.js';
import type { CliOptions, DocumentMetadata, FetchResult, PageResources, PipelineResult, SearchEngine } from './types.js';

interface SearchResultItem {
  index: number;
  title: string;
  url: string;
  displayUrl?: string;
  snippet?: string;
}

interface ParsedSearchPage {
  results: SearchResultItem[];
}

export async function runSearchPipeline(query: string, options: CliOptions): Promise<PipelineResult> {
  const fetchedAt = new Date().toISOString();
  const engine = options.searchEngine;

  try {
    const result = await fetchSearchPage(engine, query, options);
    const accessStatus = detectAccessStatus(result.html, result.status);

    if (result.status < 200 || result.status >= 300) {
      const message = `HTTP ${result.status} ${result.statusText}`.trim();
      throw new MdurlError('http', message, {
        status: result.status,
        url: result.url,
        contentType: result.contentType,
        accessStatus,
      });
    }

    const parsed = parseSearchResults(result.html, result.url, engine);
    const markdown = renderSearchMarkdown(query, engine, parsed.results, result.url);
    const truncated = truncateMarkdown(markdown, options.maxBytes);
    const resources = searchResources(parsed.results);
    const metadata: DocumentMetadata = {
      url: result.url,
      fetched_at: fetchedAt,
      status: result.status,
      render_mode: result.renderMode,
      elapsed_ms: result.elapsedMs,
      word_count: wordCount(truncated.markdown),
      content_type: result.contentType,
      content_kind: 'search',
      search_engine: engine,
      search_query: query,
      result_count: parsed.results.length,
      byte_count: result.body?.byteLength,
      access_status: accessStatus,
      link_count: resources.links.length || undefined,
      truncated: truncated.truncated || undefined,
    };

    if (result.originalUrl !== result.url) {
      metadata.original_url = result.originalUrl;
    }

    return {
      ok: true,
      metadata,
      markdown: truncated.markdown,
      resources,
      structuredData: [],
      exitCode: 0,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const metadata: DocumentMetadata = {
      url: normalized.url ?? searchUrlFor(engine, query),
      title: undefined,
      fetched_at: fetchedAt,
      status: normalized.status ?? 0,
      render_mode: normalized.kind === 'browser' ? 'js' : 'http',
      elapsed_ms: 0,
      word_count: 0,
      content_type: normalized.contentType,
      content_kind: 'search',
      search_engine: engine,
      search_query: query,
      access_status: normalized.accessStatus,
      error: normalized.message,
    };

    return {
      ok: false,
      metadata,
      markdown: '',
      resources: emptyPageResources(),
      structuredData: [],
      exitCode: normalized.exitCode,
    };
  }
}

async function fetchSearchPage(engine: SearchEngine, query: string, options: CliOptions): Promise<FetchResult> {
  const url = searchUrlFor(engine, query);

  if (options.jsMode === 'disabled') {
    return fetchPlain(url, options);
  }

  if (options.jsMode === 'force' || engine !== 'duckduckgo') {
    return fetchSearchWithBrowser(url, options);
  }

  const plain = await fetchPlain(url, options);
  const parsed = plain.status >= 200 && plain.status < 300 ? parseSearchResults(plain.html, plain.url, engine) : undefined;
  if (parsed && parsed.results.length > 0) {
    return plain;
  }

  return fetchSearchWithBrowser(url, options);
}

async function fetchSearchWithBrowser(url: string, options: CliOptions): Promise<FetchResult> {
  const session = options.getBrowserSession ? await options.getBrowserSession() : undefined;
  return session ? session.fetch(url, options) : fetchBrowser(url, options);
}

export function searchUrlFor(engine: SearchEngine, query: string): string {
  const q = new URLSearchParams({ q: query });

  switch (engine) {
    case 'bing':
      return `https://www.bing.com/search?${q.toString()}`;
    case 'duckduckgo':
      return `https://html.duckduckgo.com/html/?${q.toString()}`;
    case 'google':
      return `https://www.google.com/search?${q.toString()}`;
  }
}

export function parseSearchResults(html: string, baseUrl: string, engine: SearchEngine): ParsedSearchPage {
  const { document } = parseHTML(html);

  switch (engine) {
    case 'bing':
      return { results: parseBingResults(document, baseUrl) };
    case 'duckduckgo':
      return { results: parseDuckDuckGoResults(document, baseUrl) };
    case 'google':
      return { results: parseGoogleResults(document, baseUrl) };
  }
}

function parseGoogleResults(document: Document, baseUrl: string): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const heading of Array.from(document.querySelectorAll('a h3'))) {
    const anchor = heading.closest('a[href]');
    const title = normalizeText(heading.textContent ?? '');
    const url = cleanResultUrl(anchor?.getAttribute('href'), baseUrl);
    if (!anchor || !title || !url || shouldSkipSearchUrl(url, 'google') || seen.has(url)) {
      continue;
    }

    const block = closestSearchBlock(heading, ['MjjYud', 'tF2Cxc', 'Gx5Zad']) ?? anchor.parentElement ?? undefined;
    const snippet = cleanSnippet(firstText(block, ['.VwiC3b', '.IsZvec', '[data-sncf]']) || '');
    const displayUrl = cleanDisplayUrl(
      firstText(block, ['cite', '.TbwUpd', '.qLRx3b']) || hostLabel(url),
    );

    seen.add(url);
    results.push({ index: results.length + 1, title, url, displayUrl, snippet });
  }

  return results;
}

function parseBingResults(document: Document, baseUrl: string): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const item of Array.from(document.querySelectorAll('li.b_algo'))) {
    const anchor = item.querySelector('h2 a[href]');
    const title = normalizeText(anchor?.textContent ?? '');
    const url = cleanResultUrl(anchor?.getAttribute('href'), baseUrl);
    if (!anchor || !title || !url || shouldSkipSearchUrl(url, 'bing') || seen.has(url)) {
      continue;
    }

    seen.add(url);
    results.push({
      index: results.length + 1,
      title,
      url,
      displayUrl: cleanDisplayUrl(item.querySelector('cite')?.textContent ?? hostLabel(url)),
      snippet: cleanSnippet(item.querySelector('.b_caption p, p')?.textContent ?? ''),
    });
  }

  return results;
}

function parseDuckDuckGoResults(document: Document, baseUrl: string): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  const items = Array.from(document.querySelectorAll('.result, article[data-testid="result"], li[data-layout="organic"]'));

  for (const item of items) {
    const anchor =
      item.querySelector('a.result__a[href]') ||
      item.querySelector('a[data-testid="result-title-a"][href]') ||
      item.querySelector('h2 a[href]');
    const title = normalizeText(anchor?.textContent ?? '');
    const url = cleanResultUrl(anchor?.getAttribute('href'), baseUrl);
    if (!anchor || !title || !url || shouldSkipSearchUrl(url, 'duckduckgo') || seen.has(url)) {
      continue;
    }

    const displayUrl = cleanDisplayUrl(
      firstText(item, ['.result__url', '[data-testid="result-extras-url-link"]']) || hostLabel(url),
    );
    const snippet = cleanSnippet(firstText(item, ['.result__snippet', '[data-result="snippet"]']) || '');

    seen.add(url);
    results.push({ index: results.length + 1, title, url, displayUrl, snippet });
  }

  return results;
}

function renderSearchMarkdown(
  query: string,
  engine: SearchEngine,
  results: SearchResultItem[],
  sourceUrl: string,
): string {
  const lines = [
    `# Search Results: ${query}`,
    '',
    `- **Engine:** ${engineLabel(engine)}`,
    `- **Source:** ${sourceUrl}`,
    `- **Results:** ${results.length}`,
    '',
  ];

  if (results.length === 0) {
    lines.push('No organic results extracted.');
    return `${lines.join('\n').trimEnd()}\n`;
  }

  lines.push('## Results', '');

  for (const result of results) {
    lines.push(`### ${result.index}. [${escapeMarkdown(result.title)}](${result.url})`);
    if (result.displayUrl) {
      lines.push('', `- **Source:** ${escapeMarkdown(result.displayUrl)}`);
    }
    lines.push(`- **URL:** ${result.url}`);
    if (result.snippet) {
      lines.push('', result.snippet);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function searchResources(results: SearchResultItem[]): PageResources {
  return {
    headings: [],
    pagination: [],
    links: results.map((result) => ({
      index: result.index,
      context: 'search_result',
      text: result.title,
      url: result.url,
    })),
    images: [],
    forms: [],
    embeds: [],
  };
}

function closestSearchBlock(element: Element, classNames: string[]): Element | undefined {
  for (let current = element.parentElement; current; current = current.parentElement) {
    const classes = current.getAttribute('class') ?? '';
    if (classNames.some((className) => classes.split(/\s+/).includes(className))) {
      return current;
    }
  }

  return undefined;
}

function firstText(root: Element | undefined, selectors: string[]): string | undefined {
  if (!root) {
    return undefined;
  }

  for (const selector of selectors) {
    const text = normalizeText(root.querySelector(selector)?.textContent ?? '');
    if (text) {
      return text;
    }
  }

  return undefined;
}

function cleanResultUrl(value: string | null | undefined, baseUrl: string): string | undefined {
  if (!value || /^(javascript|mailto|tel):/iu.test(value)) {
    return undefined;
  }

  const absolute = absolutize(value, baseUrl);

  try {
    const url = new URL(absolute);
    const trackedUrl = url.searchParams.get('q') || url.searchParams.get('url') || url.searchParams.get('uddg');
    if (trackedUrl) {
      return new URL(trackedUrl).toString();
    }

    const bingEncoded = url.searchParams.get('u');
    if (bingEncoded) {
      const decoded = decodeBingUrl(bingEncoded);
      if (decoded) {
        return decoded;
      }
    }

    return url.toString();
  } catch {
    return absolute;
  }
}

function decodeBingUrl(value: string): string | undefined {
  const encoded = value.replace(/^a1/iu, '');
  const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), '=');

  try {
    const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /^https?:\/\//iu.test(decoded) ? new URL(decoded).toString() : undefined;
  } catch {
    return undefined;
  }
}

function shouldSkipSearchUrl(url: string, engine: SearchEngine): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./iu, '');
    if (engine === 'google' && (host === 'google.com' || host.endsWith('.google.com'))) {
      return true;
    }
    if (engine === 'bing' && (host === 'bing.com' || host.endsWith('.bing.com'))) {
      return true;
    }
    if (engine === 'duckduckgo' && (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com'))) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function cleanSnippet(value: string): string | undefined {
  const cleaned = normalizeText(value)
    .replace(/\bRead more$/iu, '')
    .replace(/\s+\.\.\.$/u, ' ...')
    .trim();

  return cleaned || undefined;
}

function cleanDisplayUrl(value: string): string | undefined {
  const cleaned = normalizeText(value);
  return cleaned || undefined;
}

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./iu, '');
  } catch {
    return value;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function absolutize(value: string, baseUrl: string): string {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function engineLabel(engine: SearchEngine): string {
  switch (engine) {
    case 'bing':
      return 'Bing';
    case 'duckduckgo':
      return 'DuckDuckGo';
    case 'google':
      return 'Google';
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function truncateMarkdown(markdown: string, maxBytes?: number): { markdown: string; truncated: boolean } {
  if (!maxBytes || Buffer.byteLength(markdown, 'utf8') <= maxBytes) {
    return { markdown, truncated: false };
  }

  const marker = '\n\n[truncated]\n';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const budget = Math.max(0, maxBytes - markerBytes);
  const buffer = Buffer.from(markdown, 'utf8');
  const truncated = buffer.subarray(0, budget).toString('utf8').replace(/\uFFFD$/u, '').trimEnd();

  return {
    markdown: `${truncated}${marker}`,
    truncated: true,
  };
}
