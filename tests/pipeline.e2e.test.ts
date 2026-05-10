import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatResult, runPipeline } from '../src/pipeline.js';
import type { CliOptions } from '../src/types.js';

const fixtures = join(import.meta.dirname, 'fixtures');

const baseOptions: CliOptions = {
  timeoutMs: 5000,
  headers: [],
  userAgent: 'mdurl-test',
  maxRedirects: 5,
  archiveFallback: false,
  jsMode: 'disabled',
  waitMs: 0,
  full: false,
  includeLinks: false,
  resources: true,
  structuredData: true,
  transcripts: true,
  json: false,
  frontmatter: true,
  quiet: true,
};

describe('pipeline e2e', () => {
  let server: Server;
  let baseUrl: string;
  let flakyHits = 0;
  let slowHits = 0;
  let cacheHits = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/redirects/final' });
        response.end();
        return;
      }

      if (request.url === '/cookie-redirect') {
        response.writeHead(302, { location: '/cookie-final', 'set-cookie': 'gate=1; Path=/' });
        response.end();
        return;
      }

      if (request.url === '/cookie-final') {
        if (!request.headers.cookie?.includes('gate=1')) {
          response.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<h1>Missing cookie</h1>');
          return;
        }

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main><h1>Cookie Final</h1><p>Cookie carried.</p></main></body></html>');
        return;
      }

      if (request.url === '/flaky') {
        flakyHits += 1;
        if (flakyHits === 1) {
          response.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<h1>Try again</h1>');
          return;
        }

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main><h1>Recovered</h1><p>Retried successfully.</p></main></body></html>');
        return;
      }

      if (request.url === '/slow-once') {
        slowHits += 1;
        if (slowHits === 1) {
          setTimeout(() => {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            response.end('<!doctype html><html><body><main><h1>Late</h1></main></body></html>');
          }, 150);
          return;
        }

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main><h1>Recovered From Timeout</h1></main></body></html>');
        return;
      }

      if (request.url === '/bearer') {
        if (request.headers.authorization !== 'Bearer test-token') {
          response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<h1>Unauthorized</h1>');
          return;
        }

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main><h1>Authorized</h1></main></body></html>');
        return;
      }

      if (request.url === '/cached') {
        cacheHits += 1;
        if (request.headers['if-none-match'] === '"mdurl-fixture"') {
          response.writeHead(304, { etag: '"mdurl-fixture"', 'last-modified': 'Sat, 09 May 2026 12:00:00 GMT' });
          response.end();
          return;
        }

        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          etag: '"mdurl-fixture"',
          'last-modified': 'Sat, 09 May 2026 12:00:00 GMT',
        });
        response.end('<!doctype html><html><body><main><h1>Cached Page</h1><p>Cached body.</p></main></body></html>');
        return;
      }

      if (request.url === '/youtube') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html>
          <html>
            <body>
              <main><h1>Video Page</h1><p>${'Video description. '.repeat(40)}</p></main>
              <script>
                var ytInitialPlayerResponse = {
                  "captions": {
                    "playerCaptionsTracklistRenderer": {
                      "captionTracks": [
                        {
                          "baseUrl": "${baseUrl}/captions?lang=en",
                          "languageCode": "en",
                          "name": { "simpleText": "English" }
                        }
                      ]
                    }
                  }
                };
              </script>
            </body>
          </html>`);
        return;
      }

      if (request.url?.startsWith('/captions')) {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({
          events: [
            { tStartMs: 0, segs: [{ utf8: 'Hello ' }, { utf8: 'from captions.' }] },
            { tStartMs: 2100, segs: [{ utf8: 'Second line.' }] },
          ],
        }));
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

      if (request.url === '/gone') {
        response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<h1>Gone</h1>');
        return;
      }

      if (request.url?.startsWith('/cdx?')) {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify([
          ['timestamp', 'original', 'statuscode', 'mimetype'],
          ['20260509120000', `${baseUrl}/gone`, '200', 'text/html'],
        ]));
        return;
      }

      if (request.url?.startsWith('/web/20260509120000id_/')) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main><h1>Archived Copy</h1><p>From Wayback.</p></main></body></html>');
        return;
      }

      if (request.url === '/spa-error') {
        response.writeHead(500, { 'content-type': 'text/html' });
        response.end(readFileSync(join(fixtures, 'spa-shell.html'), 'utf8'));
        return;
      }

      if (request.url === '/cloudflare') {
        response.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Just a moment...</title><div id="cf-browser-verification">Checking your browser before accessing this site.</div>');
        return;
      }

      if (request.url === '/google-sorry') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          '<!doctype html><html><body><main><h1>About this page</h1><p>' +
            "Our systems have detected unusual traffic from your computer network. This page checks to see if it's " +
            'really you sending the requests, and not a robot.</p></main></body></html>',
        );
        return;
      }

      if (request.url === '/paywall') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main><h1>Subscriber Article</h1><p>Subscribe to continue reading this article.</p></main></body></html>');
        return;
      }

      if (request.url === '/login-wall') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main><h1>Private Page</h1><p>Sign in to view this page.</p></main></body></html>');
        return;
      }

      if (request.url === '/spa') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(readFileSync(join(fixtures, 'spa-shell.html'), 'utf8'));
        return;
      }

      if (request.url === '/document.pdf') {
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end(makePdf('Hello from a PDF fixture.'));
        return;
      }

      if (request.url === '/feed.xml') {
        response.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
        response.end(`<?xml version="1.0"?>
          <rss version="2.0">
            <channel>
              <title>Fixture Feed</title>
              <link>${baseUrl}/</link>
              <description>Recent fixture updates.</description>
              <item>
                <title>First entry</title>
                <link>${baseUrl}/first</link>
                <pubDate>Sat, 09 May 2026 12:00:00 GMT</pubDate>
                <description><![CDATA[<p>Feed item &amp; body.</p>]]></description>
              </item>
            </channel>
          </rss>`);
        return;
      }

      if (request.url === '/sitemap.xml') {
        response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
        response.end(`<?xml version="1.0"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url>
              <loc>${baseUrl}/docs</loc>
              <lastmod>2026-05-09</lastmod>
            </url>
            <url>
              <loc>${baseUrl}/docs/install</loc>
            </url>
          </urlset>`);
        return;
      }

      if (request.url === '/data.json') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ name: 'Fixture API', items: [{ id: 1, label: 'Alpha' }] }));
        return;
      }

      if (request.url === '/notes.txt') {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Plain text fixture.\nSecond line.');
        return;
      }

      if (request.url === '/logo.png') {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
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
    expect(output).toContain('description: A static fixture page for mdurl tests.');
    expect(output).toContain('site_name: mdurl fixtures');
    expect(output).toContain(`canonical_url: ${baseUrl}/static`);
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

  it('extracts PDF text instead of treating it as HTML', async () => {
    const result = await runPipeline(`${baseUrl}/document.pdf`, baseOptions);
    const output = formatResult(result, baseOptions);

    expect(result.ok).toBe(true);
    expect(result.metadata.content_kind).toBe('pdf');
    expect(result.metadata.page_count).toBe(1);
    expect(result.metadata.byte_count).toBeGreaterThan(0);
    expect(output).toContain('content_kind: pdf');
    expect(output).toContain('page_count: 1');
    expect(output).toContain('## Page 1');
    expect(output).toContain('Hello from a PDF fixture.');
    expect(output).not.toContain('## Page Resources');
  });

  it('renders RSS feeds as entry-oriented markdown', async () => {
    const result = await runPipeline(`${baseUrl}/feed.xml`, { ...baseOptions, jsMode: 'auto' });

    expect(result.ok).toBe(true);
    expect(result.metadata.content_kind).toBe('feed');
    expect(result.metadata.title).toBe('Fixture Feed');
    expect(result.markdown).toContain('# Fixture Feed');
    expect(result.markdown).toContain('## Entries');
    expect(result.markdown).toContain(`### [First entry](${baseUrl}/first)`);
    expect(result.markdown).toContain('Feed item & body.');
  });

  it('renders XML sitemaps as URL lists', async () => {
    const result = await runPipeline(`${baseUrl}/sitemap.xml`, baseOptions);

    expect(result.ok).toBe(true);
    expect(result.metadata.content_kind).toBe('sitemap');
    expect(result.markdown).toContain('# Sitemap');
    expect(result.markdown).toContain(`- ${baseUrl}/docs (last modified: 2026-05-09)`);
    expect(result.markdown).toContain(`- ${baseUrl}/docs/install`);
  });

  it('renders JSON, plain text, and image resources without HTML extraction', async () => {
    const json = await runPipeline(`${baseUrl}/data.json`, { ...baseOptions, jsMode: 'auto', json: true });
    const text = await runPipeline(`${baseUrl}/notes.txt`, baseOptions);
    const image = await runPipeline(`${baseUrl}/logo.png`, baseOptions);
    const jsonOutput = JSON.parse(formatResult(json, { ...baseOptions, json: true }));

    expect(json.metadata.content_kind).toBe('json');
    expect(jsonOutput.markdown).toContain('"name": "Fixture API"');
    expect(text.metadata.content_kind).toBe('text');
    expect(text.markdown).toContain('Plain text fixture.');
    expect(image.metadata.content_kind).toBe('image');
    expect(image.markdown).toContain(`![Logo](${baseUrl}/logo.png)`);
  });

  it('can omit default page resources', async () => {
    const result = await runPipeline(`${baseUrl}/static`, { ...baseOptions, resources: false });

    expect(result.markdown).not.toContain('## Page Resources');
    expect(result.metadata.link_count).toBeUndefined();
    expect(result.metadata.heading_count).toBeUndefined();
    expect(result.metadata.pagination_count).toBeUndefined();
    expect(result.metadata.form_count).toBeUndefined();
    expect(result.metadata.embed_count).toBeUndefined();
    expect(result.resources.headings).toEqual([]);
    expect(result.resources.pagination).toEqual([]);
    expect(result.resources.links).toEqual([]);
    expect(result.resources.forms).toEqual([]);
    expect(result.resources.embeds).toEqual([]);
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

  it('can fall back to an archived snapshot for 4xx pages', async () => {
    const result = await runPipeline(`${baseUrl}/gone`, {
      ...baseOptions,
      archiveFallback: true,
      archiveBaseUrl: baseUrl,
    });

    expect(result.ok).toBe(true);
    expect(result.metadata.original_url).toBe(`${baseUrl}/gone`);
    expect(result.metadata.archived_url).toContain('/web/20260509120000id_/');
    expect(result.markdown).toContain('# Archived Copy');
  });

  it('appends YouTube transcripts when caption tracks are available', async () => {
    const result = await runPipeline(`${baseUrl}/youtube`, baseOptions);

    expect(result.ok).toBe(true);
    expect(result.metadata.transcript_count).toBe(1);
    expect(result.markdown).toContain('## Transcript');
    expect(result.markdown).toContain('- **Language:** English / en');
    expect(result.markdown).toContain('[0:00] Hello from captions.');
    expect(result.markdown).toContain('[0:02] Second line.');
  });

  it('does not browser-render non-2xx SPA-shaped errors in auto mode', async () => {
    const result = await runPipeline(`${baseUrl}/spa-error`, { ...baseOptions, jsMode: 'auto' });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.metadata.status).toBe(500);
    expect(result.metadata.render_mode).toBe('http');
    expect(result.metadata.error).toContain('HTTP 500');
  });

  it('flags bot challenges on HTTP errors', async () => {
    const result = await runPipeline(`${baseUrl}/cloudflare`, baseOptions);
    const output = formatResult(result, baseOptions);

    expect(result.ok).toBe(false);
    expect(result.metadata.access_status).toBe('bot_challenge');
    expect(result.metadata.error).toContain('bot challenge detected');
    expect(output).toContain('access_status: bot_challenge');
  });

  it('flags explicit bot challenge pages even when they return 200', async () => {
    const result = await runPipeline(`${baseUrl}/google-sorry`, baseOptions);

    expect(result.ok).toBe(true);
    expect(result.metadata.access_status).toBe('bot_challenge');
  });

  it('flags paywalls and login walls on successful pages', async () => {
    const paywall = await runPipeline(`${baseUrl}/paywall`, baseOptions);
    const loginWall = await runPipeline(`${baseUrl}/login-wall`, baseOptions);

    expect(paywall.ok).toBe(true);
    expect(paywall.metadata.access_status).toBe('paywall');
    expect(loginWall.ok).toBe(true);
    expect(loginWall.metadata.access_status).toBe('login_wall');
  });

  it('tracks redirect chains', async () => {
    const result = await runPipeline(`${baseUrl}/redirect`, baseOptions);

    expect(result.metadata.original_url).toBe(`${baseUrl}/redirect`);
    expect(result.metadata.url).toBe(`${baseUrl}/redirects/final`);
    expect(result.metadata.redirect_chain).toEqual([`${baseUrl}/redirect`]);
  });

  it('carries Set-Cookie across redirects', async () => {
    const result = await runPipeline(`${baseUrl}/cookie-redirect`, baseOptions);

    expect(result.ok).toBe(true);
    expect(result.metadata.url).toBe(`${baseUrl}/cookie-final`);
    expect(result.markdown).toContain('# Cookie Final');
  });

  it('retries transient server failures', async () => {
    flakyHits = 0;
    const result = await runPipeline(`${baseUrl}/flaky`, baseOptions);

    expect(result.ok).toBe(true);
    expect(flakyHits).toBe(2);
    expect(result.markdown).toContain('# Recovered');
  });

  it('retries request timeouts', async () => {
    slowHits = 0;
    const result = await runPipeline(`${baseUrl}/slow-once`, { ...baseOptions, timeoutMs: 50 });

    expect(result.ok).toBe(true);
    expect(slowHits).toBe(2);
    expect(result.markdown).toContain('# Recovered From Timeout');
  });

  it('sends bearer tokens as authorization headers', async () => {
    const result = await runPipeline(`${baseUrl}/bearer`, { ...baseOptions, bearer: 'test-token' });

    expect(result.ok).toBe(true);
    expect(result.markdown).toContain('# Authorized');
  });

  it('revalidates cached HTTP responses with conditional headers', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'mdurl-cache-'));
    cacheHits = 0;

    try {
      const first = await runPipeline(`${baseUrl}/cached`, { ...baseOptions, cacheDir });
      const second = await runPipeline(`${baseUrl}/cached`, { ...baseOptions, cacheDir });

      expect(first.ok).toBe(true);
      expect(first.metadata.cache_status).toBe('miss');
      expect(second.ok).toBe(true);
      expect(second.metadata.cache_status).toBe('revalidated');
      expect(second.markdown).toContain('# Cached Page');
      expect(cacheHits).toBe(2);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
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
          route: vi.fn(async () => undefined),
          newPage: vi.fn(async () => ({
            goto: vi.fn(async () => ({
              status: () => 200,
              statusText: () => 'OK',
              headers: () => ({ 'content-type': 'text/html' }),
            })),
            content: vi.fn(async () => html),
            url: vi.fn(() => finalUrl),
            waitForLoadState: vi.fn(async () => undefined),
            waitForFunction: vi.fn(async () => undefined),
            waitForTimeout: vi.fn(),
            close: vi.fn(async () => undefined),
          })),
          close: vi.fn(),
        })),
        close: vi.fn(),
      })),
    },
  }));
}

function makePdf(text: string): Buffer {
  const escaped = text.replace(/[()\\]/g, '\\$&');
  const content = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let output = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += object;
  }

  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';

  for (const offset of offsets) {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
