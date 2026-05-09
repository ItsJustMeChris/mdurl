import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatResult, runPipeline } from '../src/pipeline.js';
import type { CliOptions } from '../src/types.js';

const fixtures = join(import.meta.dirname, 'fixtures');

const baseOptions: CliOptions = {
  timeoutMs: 5000,
  headers: [],
  userAgent: 'mdurl-test',
  maxRedirects: 5,
  jsMode: 'disabled',
  waitMs: 0,
  full: false,
  includeLinks: false,
  resources: true,
  structuredData: true,
  json: false,
  frontmatter: true,
  quiet: true,
};

describe('pipeline e2e', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/redirects/final' });
        response.end();
        return;
      }

      if (request.url === '/redirects/final') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(readFileSync(join(fixtures, 'redirects/final.html'), 'utf8'));
        return;
      }

      if (request.url === '/missing') {
        response.writeHead(500, { 'content-type': 'text/html' });
        response.end('<h1>Failure</h1>');
        return;
      }

      if (request.url === '/spa-error') {
        response.writeHead(500, { 'content-type': 'text/html' });
        response.end(readFileSync(join(fixtures, 'spa-shell.html'), 'utf8'));
        return;
      }

      if (request.url === '/spa') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(readFileSync(join(fixtures, 'spa-shell.html'), 'utf8'));
        return;
      }

      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(readFileSync(join(fixtures, 'static.html'), 'utf8'));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  afterEach(() => {
    vi.doUnmock('playwright-core');
    vi.clearAllMocks();
  });

  it('fetches a static page as frontmatter plus markdown', async () => {
    const result = await runPipeline(`${baseUrl}/static`, baseOptions);
    const output = formatResult(result, baseOptions);

    expect(result.ok).toBe(true);
    expect(output).toContain('status: 200');
    expect(output).toContain('render_mode: http');
    expect(output).toContain('# Example Domain');
    expect(output).toContain('## Page Resources');
  });

  it('returns a JSON envelope', async () => {
    const result = await runPipeline(`${baseUrl}/static`, { ...baseOptions, json: true });
    const output = formatResult(result, { ...baseOptions, json: true });
    const parsed = JSON.parse(output);

    expect(parsed.status).toBe(200);
    expect(parsed.markdown).toContain('# Example Domain');
    expect(parsed.resources.links.length).toBeGreaterThan(0);
    expect(parsed.structured_data).toEqual([]);
  });

  it('can omit default page resources', async () => {
    const result = await runPipeline(`${baseUrl}/static`, { ...baseOptions, resources: false });

    expect(result.markdown).not.toContain('## Page Resources');
    expect(result.metadata.link_count).toBeUndefined();
    expect(result.resources.links).toEqual([]);
  });

  it('can omit default structured data', async () => {
    const result = await runPipeline(`${baseUrl}/static`, { ...baseOptions, structuredData: false });

    expect(result.metadata.structured_data_count).toBeUndefined();
    expect(result.structuredData).toEqual([]);
  });

  it('reports HTTP failures in the same envelope shape', async () => {
    const result = await runPipeline(`${baseUrl}/missing`, baseOptions);
    const output = formatResult(result, baseOptions);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(output).toContain('status: 500');
    expect(output).toContain('error: HTTP 500');
  });

  it('does not browser-render non-2xx SPA-shaped errors in auto mode', async () => {
    const result = await runPipeline(`${baseUrl}/spa-error`, { ...baseOptions, jsMode: 'auto' });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.metadata.status).toBe(500);
    expect(result.metadata.render_mode).toBe('http');
    expect(result.metadata.error).toContain('HTTP 500');
  });

  it('tracks redirect chains', async () => {
    const result = await runPipeline(`${baseUrl}/redirect`, baseOptions);

    expect(result.metadata.original_url).toBe(`${baseUrl}/redirect`);
    expect(result.metadata.url).toBe(`${baseUrl}/redirects/final`);
    expect(result.metadata.redirect_chain).toEqual([`${baseUrl}/redirect`]);
  });

  it('truncates markdown with an explicit marker', async () => {
    const result = await runPipeline(`${baseUrl}/static`, { ...baseOptions, maxBytes: 40 });

    expect(result.metadata.truncated).toBe(true);
    expect(result.markdown).toContain('[truncated]');
  });

  it('uses browser rendering when JS is forced', async () => {
    mockPlaywright('<html><head><title>Rendered</title></head><body><main><h1>Rendered App</h1></main></body></html>', `${baseUrl}/app`);

    const result = await runPipeline(`${baseUrl}/static`, { ...baseOptions, jsMode: 'force' });

    expect(result.ok).toBe(true);
    expect(result.metadata.render_mode).toBe('js');
    expect(result.markdown).toContain('# Rendered App');
  });

  it('falls back to browser rendering for a detected SPA shell', async () => {
    mockPlaywright('<html><head><title>Rendered SPA</title></head><body><main><h1>Rendered SPA</h1></main></body></html>', `${baseUrl}/spa`);

    const result = await runPipeline(`${baseUrl}/spa`, { ...baseOptions, jsMode: 'auto' });

    expect(result.ok).toBe(true);
    expect(result.metadata.render_mode).toBe('js');
    expect(result.markdown).toContain('# Rendered SPA');
  });
});

function mockPlaywright(html: string, finalUrl: string): void {
  vi.doMock('playwright-core', () => ({
    chromium: {
      launch: vi.fn(async () => ({
        newContext: vi.fn(async () => ({
          newPage: vi.fn(async () => ({
            goto: vi.fn(async () => ({
              status: () => 200,
              statusText: () => 'OK',
              headers: () => ({ 'content-type': 'text/html' }),
            })),
            content: vi.fn(async () => html),
            url: vi.fn(() => finalUrl),
            waitForTimeout: vi.fn(),
          })),
          close: vi.fn(),
        })),
        close: vi.fn(),
      })),
    },
  }));
}
