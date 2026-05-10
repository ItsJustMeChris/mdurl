import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { cleanDocument, normalizeResourceUrls } from './clean.js';
import type { ExtractedContent } from '../types.js';

export function extractContent(
  html: string,
  baseUrl: string,
  options: { full: boolean; selector?: string },
): ExtractedContent {
  const { document } = parseHTML(html);
  return extractContentFromDocument(document, baseUrl, options);
}

export function extractContentFromDocument(
  document: Document,
  baseUrl: string,
  options: { full: boolean; selector?: string },
): ExtractedContent {
  if (options.full || options.selector) {
    return cleanDocument(document, baseUrl, options.selector);
  }

  const lang = document.documentElement.getAttribute('lang') || undefined;
  const cleaned = cleanDocument(document, baseUrl);
  const clone = document.cloneNode(true) as Document;
  const article = new Readability(clone, { keepClasses: false }).parse();

  if (!article) {
    return cleaned;
  }

  const contentDocument = parseHTML(`<article>${article.content}</article>`).document;
  const articleNode = contentDocument.querySelector('article');

  if (!articleNode) {
    return cleaned;
  }

  normalizeResourceUrls(articleNode, baseUrl);

  const title = article.title || document.querySelector('title')?.textContent?.trim() || undefined;
  const readableText = (article.textContent ?? '').trim();
  const readableHtml = withHeading(articleNode, title);

  if (shouldUseCleanFallback(readableHtml, readableText, cleaned.html, cleaned.textContent)) {
    return cleaned;
  }

  return {
    title,
    lang,
    html: readableHtml,
    textContent: readableText,
  };
}

export function shouldUseCleanFallback(
  readableHtml: string,
  readableText: string,
  cleanedHtml: string,
  cleanedText: string,
): boolean {
  const readableLength = normalizeTextLength(readableText);
  const cleanedLength = normalizeTextLength(cleanedText);

  if (cleanedLength < 800 || readableLength === 0) {
    return false;
  }

  const readableStructure = countContentStructure(readableHtml);
  const cleanedStructure = countContentStructure(cleanedHtml);
  const missedHeadings =
    cleanedStructure.headings >= 8 && readableStructure.headings < cleanedStructure.headings * 0.5;
  const missedPrices =
    cleanedStructure.priceLike >= 8 && readableStructure.priceLike < cleanedStructure.priceLike * 0.5;
  const severelyMissedHeadings =
    cleanedStructure.headings >= 8 && readableStructure.headings < Math.max(2, cleanedStructure.headings * 0.25);

  if (severelyMissedHeadings) {
    return true;
  }

  const ratio = readableLength / cleanedLength;
  if (ratio >= 0.35) {
    return false;
  }

  return ratio < 0.2 && (missedHeadings || missedPrices);
}

function withHeading(articleNode: Element, title?: string): string {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) {
    return articleNode.outerHTML;
  }

  const firstHeading = articleNode.querySelector('h1');
  if (firstHeading?.textContent?.trim()) {
    return articleNode.outerHTML;
  }

  const h1 = articleNode.ownerDocument.createElement('h1');
  h1.textContent = normalizedTitle;
  articleNode.insertBefore(h1, articleNode.firstChild);
  return articleNode.outerHTML;
}

function normalizeTextLength(value: string): number {
  return value.replace(/\s+/g, ' ').trim().length;
}

function countContentStructure(html: string): { headings: number; priceLike: number } {
  const { document } = parseHTML(`<main>${html}</main>`);
  const text = document.body?.textContent ?? '';

  return {
    headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').length,
    priceLike: text.match(/\$?\b\d+\.\d{2}\b/g)?.length ?? 0,
  };
}
