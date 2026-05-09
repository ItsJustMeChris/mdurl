import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FetchResult } from '../types.js';

interface CacheEntry {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType?: string;
  body: string;
  savedAt: string;
}

export async function readCacheEntry(cacheDir: string | undefined, url: string): Promise<FetchResult | undefined> {
  if (!cacheDir) {
    return undefined;
  }

  try {
    const entry = JSON.parse(await readFile(cachePath(cacheDir, url), 'utf8')) as CacheEntry;
    const body = Buffer.from(entry.body, 'base64');
    return {
      originalUrl: entry.url,
      url: entry.url,
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers,
      contentType: entry.contentType,
      html: decodeBody(body, entry.contentType),
      body,
      cacheStatus: 'hit',
      redirectChain: [],
      elapsedMs: 0,
      renderMode: 'http',
    };
  } catch {
    return undefined;
  }
}

export async function writeCacheEntry(cacheDir: string | undefined, result: FetchResult): Promise<void> {
  if (!cacheDir || !result.body || result.status < 200 || result.status >= 300) {
    return;
  }

  const entry: CacheEntry = {
    url: result.url,
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    contentType: result.contentType,
    body: Buffer.from(result.body).toString('base64'),
    savedAt: new Date().toISOString(),
  };

  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath(cacheDir, result.url), JSON.stringify(entry), 'utf8');
}

export function addConditionalHeaders(headers: Headers, cached: FetchResult | undefined): void {
  if (!cached) {
    return;
  }

  const etag = cached.headers.etag;
  const lastModified = cached.headers['last-modified'];

  if (etag && !headers.has('if-none-match')) {
    headers.set('if-none-match', etag);
  }

  if (lastModified && !headers.has('if-modified-since')) {
    headers.set('if-modified-since', lastModified);
  }
}

export function cachedResultFromNotModified(cached: FetchResult, currentUrl: string, originalUrl: string, redirectChain: string[], start: number): FetchResult {
  return {
    ...cached,
    originalUrl,
    url: currentUrl,
    redirectChain,
    elapsedMs: Date.now() - start,
    cacheStatus: 'revalidated',
  };
}

function cachePath(cacheDir: string, url: string): string {
  return join(cacheDir, `${createHash('sha256').update(url).digest('hex')}.json`);
}

function decodeBody(body: Uint8Array, contentType?: string): string {
  const charset = contentType?.match(/\bcharset=([^;]+)/i)?.[1]?.trim().replace(/^["']|["']$/g, '');

  try {
    return new TextDecoder(charset || 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}
