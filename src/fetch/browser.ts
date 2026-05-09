import { existsSync } from 'node:fs';
import { MdurlError } from '../errors.js';
import type { BrowserFetchOptions, FetchResult } from '../types.js';
import { buildHeaders } from './plain.js';

const COMMON_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

export async function fetchBrowser(url: string, options: BrowserFetchOptions): Promise<FetchResult> {
  let chromium: typeof import('playwright-core').chromium;

  try {
    ({ chromium } = await import('playwright-core'));
  } catch (error) {
    throw new MdurlError('browser', browserInstallMessage(), { url, cause: error });
  }

  const start = Date.now();
  const headers = headersToObject(buildHeaders(options));
  const executablePath = options.browserPath ?? detectChromePath();
  let browser: import('playwright-core').Browser | undefined;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
    });
  } catch (error) {
    throw new MdurlError('browser', browserInstallMessage(error), { url, cause: error });
  }

  try {
    const context = await browser.newContext({
      userAgent: options.userAgent,
      extraHTTPHeaders: headers,
    });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs,
      referer: options.referer,
    });

    if (options.waitSelector) {
      await page.waitForSelector(options.waitSelector, { timeout: options.timeoutMs });
    } else {
      await page.waitForLoadState('networkidle', { timeout: Math.min(options.timeoutMs, 3000) }).catch(() => undefined);
    }

    if (options.waitMs > 0) {
      await page.waitForTimeout(options.waitMs);
    }

    const html = await page.content();
    const finalUrl = page.url();
    const status = response?.status() ?? 0;
    const responseHeaders = response?.headers() ?? {};

    await context.close();

    return {
      originalUrl: new URL(url).toString(),
      url: finalUrl,
      status,
      statusText: response?.statusText() ?? '',
      headers: responseHeaders,
      contentType: responseHeaders['content-type'],
      html,
      redirectChain: [],
      elapsedMs: Date.now() - start,
      renderMode: 'js',
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new MdurlError('timeout', `Browser render timed out after ${options.timeoutMs}ms`, {
        url,
        cause: error,
      });
    }

    throw new MdurlError('network', errorMessage(error), { url, cause: error });
  } finally {
    await browser.close();
  }
}

export function browserInstallMessage(cause?: unknown): string {
  const suffix = cause instanceof Error ? ` (${cause.message})` : '';
  return `Browser unavailable. Run "mdurl install-browser" or pass --browser-path to Chrome/Chromium.${suffix}`;
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key !== 'user-agent') {
      result[key] = value;
    }
  });
  return result;
}

function detectChromePath(): string | undefined {
  return COMMON_CHROME_PATHS.find((path) => existsSync(path));
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
