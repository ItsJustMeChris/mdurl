import { MdurlError } from '../errors.js';
import type { FetchResult, PlainFetchOptions } from '../types.js';
import { fetchPlain } from './plain.js';

export async function fetchArchiveSnapshot(url: string, options: PlainFetchOptions): Promise<FetchResult | undefined> {
  const baseUrl = options.archiveBaseUrl ?? 'https://web.archive.org';
  const cdxUrl = `${baseUrl.replace(/\/$/, '')}/cdx?url=${encodeURIComponent(url)}&output=json&fl=timestamp,original,statuscode,mimetype&filter=statuscode:200&limit=1&sort=reverse`;
  let cdx: FetchResult;

  try {
    cdx = await fetchPlain(cdxUrl, { ...options, archiveFallback: false });
  } catch {
    return undefined;
  }

  if (cdx.status < 200 || cdx.status >= 300) {
    return undefined;
  }

  const snapshot = parseCdx(cdx.html);
  if (!snapshot) {
    return undefined;
  }

  const snapshotUrl = `${baseUrl.replace(/\/$/, '')}/web/${snapshot.timestamp}id_/${snapshot.original}`;

  try {
    const archived = await fetchPlain(snapshotUrl, { ...options, archiveFallback: false });
    return {
      ...archived,
      originalUrl: url,
      headers: {
        ...archived.headers,
        'x-mdurl-archived-url': archived.url,
      },
    };
  } catch (error) {
    if (error instanceof MdurlError) {
      return undefined;
    }

    throw error;
  }
}

function parseCdx(value: string): { timestamp: string; original: string } | undefined {
  let rows: unknown;

  try {
    rows = JSON.parse(value);
  } catch {
    return undefined;
  }

  if (!Array.isArray(rows) || rows.length < 2) {
    return undefined;
  }

  const header = Array.isArray(rows[0]) ? rows[0].map(String) : [];
  const timestampIndex = header.indexOf('timestamp');
  const originalIndex = header.indexOf('original');
  const first = rows.find((row, index) => index > 0 && Array.isArray(row)) as unknown[] | undefined;

  if (!first || timestampIndex < 0 || originalIndex < 0) {
    return undefined;
  }

  const timestamp = String(first[timestampIndex] ?? '');
  const original = String(first[originalIndex] ?? '');
  return timestamp && original ? { timestamp, original } : undefined;
}
