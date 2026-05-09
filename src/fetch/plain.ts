import { MdurlError } from '../errors.js';
import type { FetchResult, PlainFetchOptions } from '../types.js';

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 100;

export function buildHeaders(options: PlainFetchOptions): Headers {
  const headers = new Headers();
  headers.set('user-agent', options.userAgent);
  headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');

  if (options.cookie) {
    headers.set('cookie', options.cookie);
  }

  if (options.referer) {
    headers.set('referer', options.referer);
  }

  for (const header of options.headers) {
    headers.set(header.name, header.value);
  }

  return headers;
}

export async function fetchPlain(url: string, options: PlainFetchOptions): Promise<FetchResult> {
  const start = Date.now();
  const originalUrl = normalizeUrl(url);
  let cookieHeader = options.cookie;
  let lastError: MdurlError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let currentUrl = originalUrl;
    const redirectChain: string[] = [];

    for (let redirects = 0; redirects <= options.maxRedirects; redirects += 1) {
      let response: Response;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

      try {
        response = await fetch(currentUrl, {
          headers: buildHeaders({ ...options, cookie: cookieHeader }),
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          lastError = new MdurlError('timeout', `Request timed out after ${options.timeoutMs}ms`, {
            url: currentUrl,
            cause: error,
          });
          break;
        }

        throw new MdurlError('network', errorMessage(error), {
          url: currentUrl,
          cause: error,
        });
      } finally {
        clearTimeout(timeout);
      }

      cookieHeader = mergeSetCookies(cookieHeader, getSetCookieHeaders(response.headers));

      if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          const result = await responseToResult(response, originalUrl, currentUrl, redirectChain, start);
          if (shouldRetryStatus(result.status, attempt)) {
            break;
          }
          return result;
        }

        if (redirects === options.maxRedirects) {
          throw new MdurlError(
            'network',
            `Too many redirects; exceeded --max-redirects ${options.maxRedirects}`,
            { status: response.status, url: currentUrl, contentType: response.headers.get('content-type') ?? undefined },
          );
        }

        redirectChain.push(currentUrl);
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const result = await responseToResult(response, originalUrl, currentUrl, redirectChain, start);
      if (shouldRetryStatus(result.status, attempt)) {
        break;
      }
      return result;
    }

    if (attempt < MAX_RETRIES) {
      await delay(RETRY_BASE_MS * 2 ** attempt);
      continue;
    }

    if (lastError) {
      throw lastError;
    }
  }

  throw new MdurlError('network', `Too many redirects; exceeded --max-redirects ${options.maxRedirects}`, {
    url: originalUrl,
  });
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return new URL(`https://${value}`).toString();
  }
}

async function responseToResult(
  response: Response,
  originalUrl: string,
  finalUrl: string,
  redirectChain: string[],
  start: number,
): Promise<FetchResult> {
  const body = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? undefined;
  const html = decodeBody(body, contentType);
  const headers: Record<string, string> = {};

  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    originalUrl,
    url: finalUrl,
    status: response.status,
    statusText: response.statusText,
    headers,
    contentType,
    html,
    body,
    redirectChain,
    elapsedMs: Date.now() - start,
    renderMode: 'http',
  };
}

function decodeBody(body: Uint8Array, contentType?: string): string {
  const charset = contentType?.match(/\bcharset=([^;]+)/i)?.[1]?.trim().replace(/^["']|["']$/g, '');

  try {
    return new TextDecoder(charset || 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function shouldRetryStatus(status: number, attempt: number): boolean {
  return attempt < MAX_RETRIES && (status === 429 || status === 500 || status === 502 || status === 503 || status === 504);
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = withSetCookie.getSetCookie?.();
  if (values && values.length > 0) {
    return values;
  }

  const combined = headers.get('set-cookie');
  return combined ? [combined] : [];
}

function mergeSetCookies(cookieHeader: string | undefined, setCookies: string[]): string | undefined {
  if (setCookies.length === 0) {
    return cookieHeader;
  }

  const cookies = new Map<string, string>();
  for (const cookie of cookieHeader?.split(';') ?? []) {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (name && valueParts.length > 0) {
      cookies.set(name, valueParts.join('='));
    }
  }

  for (const setCookie of setCookies) {
    const [pair] = setCookie.split(';');
    const [name, ...valueParts] = pair.trim().split('=');
    if (name && valueParts.length > 0) {
      cookies.set(name, valueParts.join('='));
    }
  }

  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ') || undefined;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
