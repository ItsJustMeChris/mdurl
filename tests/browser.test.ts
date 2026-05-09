import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserFetchOptions } from '../src/types.js';

const options: BrowserFetchOptions = {
  timeoutMs: 5000,
  headers: [],
  userAgent: 'mdurl-test',
  maxRedirects: 5,
  waitMs: 0,
};

describe('createBrowserSession', () => {
  afterEach(() => {
    vi.doUnmock('playwright-core');
    vi.resetModules();
  });

  it('reuses one browser context for multiple rendered URLs', async () => {
    const browserClose = vi.fn(async () => undefined);
    const contextClose = vi.fn(async () => undefined);
    const pageClose = vi.fn(async () => undefined);
    const page = {
      goto: vi.fn(async (url: string) => ({
        status: () => 200,
        statusText: () => 'OK',
        headers: () => ({ 'content-type': 'text/html' }),
        url,
      })),
      waitForLoadState: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      content: vi.fn(async () => '<html><body><h1>Rendered</h1></body></html>'),
      url: vi.fn(() => 'https://example.com/rendered'),
      close: pageClose,
    };
    const context = {
      newPage: vi.fn(async () => page),
      close: contextClose,
    };
    const launch = vi.fn(async () => ({
      newContext: vi.fn(async () => context),
      close: browserClose,
    }));

    vi.doMock('playwright-core', () => ({
      chromium: { launch },
    }));

    const { createBrowserSession } = await import('../src/fetch/browser.js');
    const session = await createBrowserSession(options);

    await session.fetch('https://example.com/a', options);
    await session.fetch('https://example.com/b', options);
    await session.close();

    expect(launch).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledTimes(2);
    expect(pageClose).toHaveBeenCalledTimes(2);
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(browserClose).toHaveBeenCalledTimes(1);
  });
});
