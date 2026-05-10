import { parseHTML } from 'linkedom';

export interface HeadMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  canonicalUrl?: string;
}

export function extractHeadMetadata(html: string, baseUrl: string): HeadMetadata {
  const { document } = parseHTML(html);
  return extractHeadMetadataFromDocument(document, baseUrl);
}

export function extractHeadMetadataFromDocument(document: Document, baseUrl: string): HeadMetadata {
  return {
    title: text(document.querySelector('title')?.textContent),
    description:
      metaContent(document, 'meta[name="description"]') ||
      metaContent(document, 'meta[property="og:description"]') ||
      metaContent(document, 'meta[name="twitter:description"]'),
    siteName:
      metaContent(document, 'meta[property="og:site_name"]') ||
      metaContent(document, 'meta[name="application-name"]'),
    canonicalUrl: absoluteUrl(document.querySelector('link[rel~="canonical"]')?.getAttribute('href'), baseUrl),
  };
}

function metaContent(document: Document, selector: string): string | undefined {
  return text(document.querySelector(selector)?.getAttribute('content'));
}

function text(value: string | null | undefined): string | undefined {
  return value?.replace(/\s+/g, ' ').trim() || undefined;
}

function absoluteUrl(value: string | null | undefined, baseUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}
