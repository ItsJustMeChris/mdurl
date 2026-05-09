import { MdurlError } from '../errors.js';
import type { FetchResult, PlainFetchOptions } from '../types.js';

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
  let currentUrl = originalUrl;
  const redirectChain: string[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    for (let redirects = 0; redirects <= options.maxRedirects; redirects += 1) {
      let response: Response;

      try {
        response = await fetch(currentUrl, {
          headers: buildHeaders(options),
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new MdurlError('timeout', `Request timed out after ${options.timeoutMs}ms`, {
            url: currentUrl,
            cause: error,
          });
        }

        throw new MdurlError('network', errorMessage(error), {
          url: currentUrl,
          cause: error,
        });
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          return responseToResult(response, originalUrl, currentUrl, redirectChain, start);
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

      return responseToResult(response, originalUrl, currentUrl, redirectChain, start);
    }
  } finally {
    clearTimeout(timeout);
  }

  throw new MdurlError('network', `Too many redirects; exceeded --max-redirects ${options.maxRedirects}`, {
    url: currentUrl,
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
