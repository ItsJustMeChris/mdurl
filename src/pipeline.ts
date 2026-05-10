import { writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { MdurlError, normalizeError } from './errors.js';
import { fetchArchiveSnapshot } from './fetch/archive.js';
import { detectSpa } from './fetch/detectSpa.js';
import { fetchBrowser } from './fetch/browser.js';
import { fetchPlain } from './fetch/plain.js';
import { htmlToMarkdown, wordCount } from './convert/markdown.js';
import { classifyContent, convertNonHtml } from './convert/nonHtml.js';
import { appendPageResources, emptyPageResources, extractPageResourcesFromDocument } from './convert/resources.js';
import { selectMarkdownSection } from './convert/section.js';
import { appendStructuredData, extractStructuredDataFromDocument } from './convert/structuredData.js';
import { appendYouTubeTranscript, extractYouTubeTranscript } from './convert/youtubeTranscript.js';
import { accessStatusLabel, detectAccessStatus, detectAccessStatusFromDocument } from './extract/access.js';
import { extractHeadMetadataFromDocument, type HeadMetadata } from './extract/head.js';
import { extractContentFromDocument } from './extract/readability.js';
import { renderFrontmatter } from './output/frontmatter.js';
import { renderJsonEnvelope } from './output/envelope.js';
import type { CliOptions, ContentKind, DocumentMetadata, FetchResult, PageResources, PipelineResult } from './types.js';

export { runSearchPipeline } from './search.js';

interface FetchContext {
  result: FetchResult;
  contentKind: ContentKind;
  document?: Document;
}

export async function runPipeline(url: string, options: CliOptions): Promise<PipelineResult> {
  const fetchedAt = new Date().toISOString();

  try {
    let fetched = await fetchWithRendering(url, options);
    let { result, contentKind, document } = fetched;
    let accessStatus = detectAccessStatusForContext(fetched);

    if (options.archiveFallback && result.status >= 400 && result.status < 500) {
      const archived = await fetchArchiveSnapshot(result.url, options);
      if (archived && archived.status >= 200 && archived.status < 300) {
        fetched = buildFetchContext(archived);
        ({ result, contentKind, document } = fetched);
        accessStatus = detectAccessStatusForContext(fetched);
      }
    }

    if (result.status < 200 || result.status >= 300) {
      const message = `HTTP ${result.status} ${result.statusText}`.trim();
      throw new MdurlError('http', accessStatus ? `${message} (${accessStatusLabel(accessStatus)})` : message, {
        status: result.status,
        url: result.url,
        contentType: result.contentType,
        accessStatus,
      });
    }

    if (contentKind !== 'html') {
      const byteCount = result.body?.byteLength;
      const converted = await convertNonHtml(result, contentKind);
      const selected = selectMarkdownSection(converted.markdown, options.section);
      const contentMarkdown = options.section ? selected.markdown : converted.markdown;
      const truncated = truncateMarkdown(contentMarkdown, options.maxBytes);
      const metadata = buildMetadata(result, {
        fetchedAt,
        title: converted.title,
        contentKind: converted.contentKind,
        byteCount,
        pageCount: converted.pageCount,
        section: options.section,
        sectionFound: options.section ? selected.found : undefined,
        accessStatus,
        markdown: truncated.markdown,
        truncated: truncated.truncated,
        resources: emptyPageResources(),
        structuredData: [],
      });

      return {
        ok: true,
        metadata,
        markdown: truncated.markdown,
        resources: emptyPageResources(),
        structuredData: [],
        exitCode: 0,
      };
    }

    const htmlDocument = document ?? parseHTML(result.html).document;
    const head = extractHeadMetadataFromDocument(htmlDocument, result.url);
    const extracted = extractContentFromDocument(htmlDocument, result.url, {
      full: options.full,
      selector: options.selector,
    });
    const converted = htmlToMarkdown(extracted.html, result.url, {
      includeLinks: options.includeLinks,
    });
    const selected = selectMarkdownSection(converted.markdown, options.section);
    const contentMarkdown = options.section ? selected.markdown : converted.markdown;
    const contentHeadingCount = countMarkdownHeadings(contentMarkdown);
    const structuredData = options.structuredData ? extractStructuredDataFromDocument(htmlDocument, result.url) : [];
    const transcript = options.transcripts ? await extractYouTubeTranscript(result.html, result.url, options) : undefined;
    const resources = options.resources ? extractPageResourcesFromDocument(htmlDocument, result.url) : emptyPageResources();
    const markdownWithData = options.structuredData
      ? appendStructuredData(contentMarkdown, structuredData)
      : contentMarkdown;
    const markdownWithTranscript = transcript ? appendYouTubeTranscript(markdownWithData, transcript) : markdownWithData;
    const markdown = options.resources ? appendPageResources(markdownWithTranscript, resources) : markdownWithTranscript;
    const truncated = truncateMarkdown(markdown, options.maxBytes);
    const metadata = buildMetadata(result, {
      fetchedAt,
      title: extracted.title || head.title,
      head,
      contentKind,
      byteCount: result.body?.byteLength,
      section: options.section,
      sectionFound: options.section ? selected.found : undefined,
      accessStatus,
      lang: extracted.lang,
      markdown: truncated.markdown,
      truncated: truncated.truncated,
      resources,
      contentHeadingCount: options.resources ? contentHeadingCount : undefined,
      structuredData,
      transcriptCount: transcript ? 1 : 0,
    });

    return {
      ok: true,
      metadata,
      markdown: truncated.markdown,
      resources,
      structuredData,
      exitCode: 0,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const metadata: DocumentMetadata = {
      url: normalized.url ?? normalizeInputUrl(url),
      title: undefined,
      fetched_at: fetchedAt,
      status: normalized.status ?? 0,
      render_mode: normalized.kind === 'browser' ? 'js' : 'http',
      elapsed_ms: 0,
      word_count: 0,
      content_type: normalized.contentType,
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

export function formatResult(result: PipelineResult, options: CliOptions): string {
  if (options.json) {
    return renderJsonEnvelope(result.metadata, result.markdown, result.resources, result.structuredData);
  }

  if (!options.frontmatter) {
    return result.markdown;
  }

  return renderFrontmatter(result.metadata, result.markdown);
}

export async function writeResult(output: string, options: CliOptions): Promise<void> {
  if (options.output) {
    await writeFile(options.output, output, 'utf8');
    return;
  }

  process.stdout.write(output);
}

async function fetchWithRendering(url: string, options: CliOptions): Promise<FetchContext> {
  if (options.jsMode === 'force') {
    return buildFetchContext(await fetchWithBrowser(url, options));
  }

  const plain = await fetchPlain(url, options);
  const plainContext = buildFetchContext(plain);

  if (plain.status < 200 || plain.status >= 300) {
    return plainContext;
  }

  if (options.jsMode === 'disabled') {
    return plainContext;
  }

  if (plainContext.contentKind !== 'html') {
    return plainContext;
  }

  const detection = detectSpa(plain, plainContext.document);

  if (!detection.isSpa) {
    return plainContext;
  }

  if (!options.quiet) {
    process.stderr.write(`mdurl: SPA shell detected (${detection.reasons.join('; ')}); rendering with browser\n`);
  }

  return buildFetchContext(await fetchWithBrowser(plain.url, options));
}

async function fetchWithBrowser(url: string, options: CliOptions): Promise<FetchResult> {
  const session = options.getBrowserSession ? await options.getBrowserSession() : undefined;
  return session ? session.fetch(url, options) : fetchBrowser(url, options);
}

function buildFetchContext(result: FetchResult): FetchContext {
  const contentKind = classifyContent(result);
  return {
    result,
    contentKind,
    document: contentKind === 'html' ? parseHtmlDocument(result.html) : undefined,
  };
}

function parseHtmlDocument(html: string): Document | undefined {
  try {
    return parseHTML(html).document;
  } catch {
    return undefined;
  }
}

function detectAccessStatusForContext(context: FetchContext): DocumentMetadata['access_status'] {
  if (context.document) {
    return detectAccessStatusFromDocument(context.document, context.result.html, context.result.status);
  }

  if (context.contentKind === 'html' || context.contentKind === 'text') {
    return detectAccessStatus(context.result.html, context.result.status);
  }

  return undefined;
}

function buildMetadata(
  result: FetchResult,
  details: {
    fetchedAt: string;
    title?: string;
    head?: HeadMetadata;
    contentKind?: ContentKind;
    byteCount?: number;
    pageCount?: number;
    section?: string;
    sectionFound?: boolean;
    accessStatus?: DocumentMetadata['access_status'];
    lang?: string;
    markdown: string;
    truncated: boolean;
    resources: PageResources;
    contentHeadingCount?: number;
    structuredData: ReturnType<typeof extractStructuredDataFromDocument>;
    transcriptCount?: number;
  },
): DocumentMetadata {
  const metadata: DocumentMetadata = {
    url: result.url,
    fetched_at: details.fetchedAt,
    status: result.status,
    render_mode: result.renderMode,
    elapsed_ms: result.elapsedMs,
    word_count: wordCount(details.markdown),
    content_type: result.contentType,
  };

  if (result.originalUrl !== result.url) {
    metadata.original_url = result.originalUrl;
  }

  if (result.headers['x-mdurl-archived-url']) {
    metadata.archived_url = result.headers['x-mdurl-archived-url'];
  }

  if (details.title) {
    metadata.title = details.title;
  }

  if (details.head?.description) {
    metadata.description = details.head.description;
  }

  if (details.head?.siteName) {
    metadata.site_name = details.head.siteName;
  }

  if (details.head?.canonicalUrl) {
    metadata.canonical_url = details.head.canonicalUrl;
  }

  if (details.contentKind) {
    metadata.content_kind = details.contentKind;
  }

  if (details.byteCount !== undefined) {
    metadata.byte_count = details.byteCount;
  }

  if (details.pageCount !== undefined) {
    metadata.page_count = details.pageCount;
  }

  if (result.cacheStatus) {
    metadata.cache_status = result.cacheStatus;
  }

  if (details.section) {
    metadata.section = details.section;
    metadata.section_found = Boolean(details.sectionFound);
  }

  if (details.accessStatus) {
    metadata.access_status = details.accessStatus;
  }

  if (details.lang) {
    metadata.lang = details.lang;
  }

  if (details.resources.links.length > 0) {
    metadata.link_count = details.resources.links.length;
  }

  const headingCount = Math.max(details.resources.headings.length, details.contentHeadingCount ?? 0);
  if (headingCount > 0) {
    metadata.heading_count = headingCount;
  }

  if (details.resources.pagination.length > 0) {
    metadata.pagination_count = details.resources.pagination.length;
  }

  if (details.resources.images.length > 0) {
    metadata.image_count = details.resources.images.length;
  }

  if (details.resources.forms.length > 0) {
    metadata.form_count = details.resources.forms.length;
  }

  if (details.resources.embeds.length > 0) {
    metadata.embed_count = details.resources.embeds.length;
  }

  if (details.structuredData.length > 0) {
    metadata.structured_data_count = details.structuredData.length;
  }

  if (details.transcriptCount) {
    metadata.transcript_count = details.transcriptCount;
  }

  if (result.redirectChain.length > 0) {
    metadata.redirect_chain = result.redirectChain;
  }

  if (details.truncated) {
    metadata.truncated = true;
  }

  return metadata;
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

function countMarkdownHeadings(markdown: string): number {
  let count = 0;
  let inFence = false;

  for (const line of markdown.split('\n')) {
    if (/^```/u.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && /^#{1,6}\s+\S/u.test(line)) {
      count += 1;
    }
  }

  return count;
}

function normalizeInputUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    try {
      return new URL(`https://${value}`).toString();
    } catch {
      return value;
    }
  }
}
