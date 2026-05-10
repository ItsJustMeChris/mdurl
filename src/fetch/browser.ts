import { existsSync } from 'node:fs';
import { MdurlError } from '../errors.js';
import type { BrowserFetchOptions, BrowserSession, FetchResult } from '../types.js';
import { buildHeaders } from './plain.js';

const DEFAULT_SETTLE_MS = 800;
const DOM_STABLE_MS = 150;
const MIN_MEANINGFUL_TEXT_LENGTH = 80;
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

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
  const session = await createBrowserSession(options, url);

  try {
    return await session.fetch(url, options);
  } finally {
    await session.close();
  }
}

export async function createBrowserSession(options: BrowserFetchOptions, launchUrl = 'about:blank'): Promise<BrowserSession> {
  let chromium: typeof import('playwright-core').chromium;

  try {
    ({ chromium } = await import('playwright-core'));
  } catch (error) {
    throw new MdurlError('browser', browserInstallMessage(), { url: launchUrl, cause: error });
  }

  const headers = headersToObject(buildHeaders(options));
  const executablePath = options.browserPath ?? detectChromePath();
  let browser: import('playwright-core').Browser;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
    });
  } catch (error) {
    throw new MdurlError('browser', browserInstallMessage(error), { url: launchUrl, cause: error });
  }

  try {
    const context = await browser.newContext({
      userAgent: options.userAgent,
      extraHTTPHeaders: headers,
    });

    await installFastResourcePolicy(context, options);

    return {
      fetch: (url, fetchOptions) => renderPage(context, url, fetchOptions),
      close: async () => {
        await context.close();
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function renderPage(
  context: import('playwright-core').BrowserContext,
  url: string,
  options: BrowserFetchOptions,
): Promise<FetchResult> {
  const start = Date.now();

  try {
    const page = await context.newPage();
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options.timeoutMs,
        referer: options.referer,
      });

      if (options.waitSelector) {
        await page.waitForSelector(options.waitSelector, { timeout: options.timeoutMs });
      } else {
        await waitForDomSettle(page, options.settleMs ?? DEFAULT_SETTLE_MS);
      }

      if (options.waitMs > 0) {
        await page.waitForTimeout(options.waitMs);
      }

      const html = await page.content();
      const finalUrl = page.url();
      const status = response?.status() ?? 0;
      const responseHeaders = response?.headers() ?? {};

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
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new MdurlError('timeout', `Browser render timed out after ${options.timeoutMs}ms`, {
        url,
        cause: error,
      });
    }

    throw new MdurlError('network', errorMessage(error), { url, cause: error });
  }
}

async function installFastResourcePolicy(
  context: import('playwright-core').BrowserContext,
  options: BrowserFetchOptions,
): Promise<void> {
  if (options.loadAssets) {
    return;
  }

  await context.route('**/*', async (route) => {
    if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

async function waitForDomSettle(page: import('playwright-core').Page, settleMs: number): Promise<void> {
  if (settleMs <= 0) {
    return;
  }

  await page
    .waitForFunction(
      ({ minTextLength, stableMs }) => {
        const body = document.body;
        if (!body) {
          return false;
        }

        const text = (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim();
        const signature = [
          document.title,
          text.length,
          body.getElementsByTagName('*').length,
          body.querySelectorAll('a[href], img, iframe, video, audio, form').length,
        ].join(':');
        const stateKey = '__mdurlDomSettle';
        const stateHost = window as unknown as Record<string, { signature: string; changedAt: number } | undefined>;
        const now = Date.now();
        const state = stateHost[stateKey] ?? { signature, changedAt: now };

        if (state.signature !== signature) {
          state.signature = signature;
          state.changedAt = now;
        }

        stateHost[stateKey] = state;

        const hasMeaningfulDom =
          text.length >= minTextLength ||
          Boolean(body.querySelector('main, article, [role="main"], h1, h2, form, nav a[href]'));

        return hasMeaningfulDom && now - state.changedAt >= stableMs;
      },
      { minTextLength: MIN_MEANINGFUL_TEXT_LENGTH, stableMs: DOM_STABLE_MS },
      { timeout: settleMs, polling: 50 },
    )
    .catch(() => undefined);
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
