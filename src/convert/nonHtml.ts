import { XMLParser } from 'fast-xml-parser';
import { PDFParse } from 'pdf-parse';
import { htmlToMarkdown } from './markdown.js';
import type { ContentKind, FetchResult } from '../types.js';

export interface ConvertedNonHtml {
  contentKind: ContentKind;
  title?: string;
  markdown: string;
  pageCount?: number;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

export function classifyContent(result: FetchResult): ContentKind {
  const mime = mediaType(result.contentType);
  const pathname = safePathname(result.url);

  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    return 'html';
  }

  if (mime === 'application/pdf' || pathname.endsWith('.pdf')) {
    return 'pdf';
  }

  if (mime === 'application/rss+xml' || mime === 'application/atom+xml') {
    return 'feed';
  }

  if (mime === 'application/json' || mime.endsWith('+json') || pathname.endsWith('.json')) {
    return 'json';
  }

  if (mime === 'application/xml' || mime === 'text/xml' || mime.endsWith('+xml') || pathname.endsWith('.xml')) {
    return 'xml';
  }

  if (mime.startsWith('text/')) {
    return 'text';
  }

  if (mime.startsWith('image/')) {
    return 'image';
  }

  if (mime.startsWith('audio/') || mime.startsWith('video/')) {
    return 'media';
  }

  if (!mime) {
    return 'html';
  }

  return 'binary';
}

export async function convertNonHtml(result: FetchResult, contentKind: ContentKind): Promise<ConvertedNonHtml> {
  switch (contentKind) {
    case 'pdf':
      return convertPdf(result);
    case 'feed':
      return convertXmlOrFeed(result, true);
    case 'json':
      return convertJson(result);
    case 'xml':
      return convertXmlOrFeed(result, false);
    case 'text':
      return convertText(result);
    case 'image':
      return convertImage(result);
    case 'media':
      return convertMedia(result);
    case 'binary':
      return convertBinary(result);
    case 'html':
      throw new Error('HTML content should use the HTML pipeline');
  }
}

async function convertPdf(result: FetchResult): Promise<ConvertedNonHtml> {
  if (!result.body) {
    return convertBinary(result);
  }

  const parser = new PDFParse({ data: result.body });

  try {
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    const title = normalizedString(infoResult.info?.Title) || titleFromUrl(result.url) || 'PDF Document';
    const sections = [`# ${title}`, '', `- Source: ${result.url}`, `- Pages: ${textResult.total}`];
    const outline = renderPdfOutline(infoResult.outline);

    if (outline) {
      sections.push('', '## Outline', '', outline);
    }

    for (const page of textResult.pages) {
      const text = normalizeBodyText(page.text);
      if (text) {
        sections.push('', `## Page ${page.num}`, '', text);
      }
    }

    return {
      contentKind: 'pdf',
      title,
      markdown: `${sections.join('\n').trimEnd()}\n`,
      pageCount: textResult.total,
    };
  } finally {
    await parser.destroy();
  }
}

function convertJson(result: FetchResult): ConvertedNonHtml {
  const title = titleFromUrl(result.url) || 'JSON Document';
  let body = result.html.trim();

  try {
    body = JSON.stringify(JSON.parse(result.html), null, 2);
  } catch {
    // Keep the original body when the server labels invalid JSON as JSON.
  }

  return {
    contentKind: 'json',
    title,
    markdown: `# ${title}\n\n- Source: ${result.url}\n\n\`\`\`json\n${body}\n\`\`\`\n`,
  };
}

function convertXmlOrFeed(result: FetchResult, forceFeed: boolean): ConvertedNonHtml {
  try {
    const parsed = xmlParser.parse(result.html) as Record<string, unknown>;
    const feed = feedFromParsedXml(parsed);

    if (feed) {
      return renderFeed(result, feed);
    }
  } catch {
    // Fall through to generic XML rendering below.
  }

  if (forceFeed) {
    return {
      contentKind: 'feed',
      title: titleFromUrl(result.url) || 'Feed',
      markdown: `# Feed\n\n- Source: ${result.url}\n\n\`\`\`xml\n${result.html.trim()}\n\`\`\`\n`,
    };
  }

  const title = titleFromUrl(result.url) || 'XML Document';
  return {
    contentKind: 'xml',
    title,
    markdown: `# ${title}\n\n- Source: ${result.url}\n\n\`\`\`xml\n${result.html.trim()}\n\`\`\`\n`,
  };
}

function convertText(result: FetchResult): ConvertedNonHtml {
  const title = titleFromUrl(result.url) || 'Text Document';
  return {
    contentKind: 'text',
    title,
    markdown: `# ${title}\n\n- Source: ${result.url}\n\n${result.html.trim()}\n`,
  };
}

function convertImage(result: FetchResult): ConvertedNonHtml {
  const title = titleFromUrl(result.url) || 'Image';
  return {
    contentKind: 'image',
    title,
    markdown: `# ${title}\n\n- Source: ${result.url}\n- Content-Type: ${result.contentType ?? 'image'}\n\n![${escapeAltText(title)}](${result.url})\n`,
  };
}

function convertMedia(result: FetchResult): ConvertedNonHtml {
  const title = titleFromUrl(result.url) || 'Media';
  return {
    contentKind: 'media',
    title,
    markdown: `# ${title}\n\n- Source: ${result.url}\n- Content-Type: ${result.contentType ?? 'media'}\n\n[Open media](${result.url})\n`,
  };
}

function convertBinary(result: FetchResult): ConvertedNonHtml {
  const title = titleFromUrl(result.url) || 'Binary Document';
  return {
    contentKind: 'binary',
    title,
    markdown: `# ${title}\n\n- Source: ${result.url}\n- Content-Type: ${result.contentType ?? 'application/octet-stream'}\n\nThis binary resource is not text-extractable by mdurl yet.\n`,
  };
}

interface FeedEntry {
  title?: string;
  url?: string;
  published?: string;
  updated?: string;
  summary?: string;
}

interface ParsedFeed {
  title?: string;
  description?: string;
  url?: string;
  entries: FeedEntry[];
}

function feedFromParsedXml(parsed: Record<string, unknown>): ParsedFeed | undefined {
  const rss = objectValue(parsed.rss);
  const channel = objectValue(rss?.channel);
  if (channel) {
    return {
      title: stringValue(channel.title),
      description: stringValue(channel.description),
      url: linkValue(channel.link),
      entries: arrayValue(channel.item).map((item) => ({
        title: stringValue(item.title),
        url: linkValue(item.link) || stringValue(item.guid),
        published: stringValue(item.pubDate),
        summary: stringValue(item.description),
      })),
    };
  }

  const atom = objectValue(parsed.feed);
  if (atom) {
    return {
      title: stringValue(atom.title),
      description: stringValue(atom.subtitle),
      url: linkValue(atom.link),
      entries: arrayValue(atom.entry).map((entry) => ({
        title: stringValue(entry.title),
        url: linkValue(entry.link) || stringValue(entry.id),
        published: stringValue(entry.published),
        updated: stringValue(entry.updated),
        summary: stringValue(entry.summary) || stringValue(entry.content),
      })),
    };
  }

  return undefined;
}

function renderFeed(result: FetchResult, feed: ParsedFeed): ConvertedNonHtml {
  const title = feed.title || titleFromUrl(result.url) || 'Feed';
  const sections = [`# ${title}`, '', `- Source: ${result.url}`];

  if (feed.url) {
    sections.push(`- Site: ${feed.url}`);
  }

  if (feed.description) {
    sections.push('', feedTextToMarkdown(feed.description, result.url));
  }

  if (feed.entries.length > 0) {
    sections.push('', '## Entries');
  }

  for (const entry of feed.entries.slice(0, 50)) {
    const entryTitle = entry.title || entry.url || 'Untitled entry';
    sections.push('', entry.url ? `### [${escapeLinkText(entryTitle)}](${entry.url})` : `### ${entryTitle}`);

    if (entry.published) {
      sections.push(`- Published: ${entry.published}`);
    }

    if (entry.updated) {
      sections.push(`- Updated: ${entry.updated}`);
    }

    if (entry.summary) {
      sections.push('', feedTextToMarkdown(entry.summary, result.url));
    }
  }

  return {
    contentKind: 'feed',
    title,
    markdown: `${sections.join('\n').trimEnd()}\n`,
  };
}

function renderPdfOutline(outline: unknown, depth = 0): string {
  if (!Array.isArray(outline) || depth > 3) {
    return '';
  }

  const lines: string[] = [];
  for (const item of outline) {
    const node = objectValue(item);
    const title = stringValue(node?.title);
    if (!node || !title) {
      continue;
    }

    lines.push(`${'  '.repeat(depth)}- ${title}`);
    const childLines = renderPdfOutline(node.items, depth + 1);
    if (childLines) {
      lines.push(childLines);
    }
  }

  return lines.join('\n');
}

function mediaType(contentType?: string): string {
  return contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function titleFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).at(-1) || parsed.hostname;
    return normalizeBodyText(
      decodeURIComponent(segment)
        .replace(/\.[a-z0-9]{1,8}$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase()),
    );
  } catch {
    return undefined;
  }
}

function normalizeBodyText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function feedTextToMarkdown(value: string, baseUrl: string): string {
  try {
    return htmlToMarkdown(`<div>${value}</div>`, baseUrl, { includeLinks: false }).markdown.trim();
  } catch {
    return normalizeBodyText(value);
  }
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === 'string' ? normalizeBodyText(value) || undefined : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return normalizeBodyText(String(value)) || undefined;
  }

  const object = objectValue(value);
  return normalizedString(object?.['#text']);
}

function linkValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizeBodyText(value) || undefined;
  }

  if (Array.isArray(value)) {
    const alternate = value.find((item) => objectValue(item)?.['@_rel'] === 'alternate') ?? value[0];
    return linkValue(alternate);
  }

  const object = objectValue(value);
  return normalizedString(object?.['@_href']) || normalizedString(object?.['#text']);
}

function arrayValue(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map(objectValue).filter((item): item is Record<string, unknown> => Boolean(item));
  }

  const object = objectValue(value);
  return object ? [object] : [];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function escapeLinkText(value: string): string {
  return value.replace(/[[\]]/g, '\\$&');
}

function escapeAltText(value: string): string {
  return value.replace(/[[\]]/g, '').replace(/\n/g, ' ');
}
