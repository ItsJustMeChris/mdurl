import { describe, expect, it } from 'vitest';
import { parseSearchResults, searchUrlFor } from '../src/search.js';

describe('searchUrlFor', () => {
  it('builds engine search URLs', () => {
    expect(searchUrlFor('google', 'weather mke')).toBe('https://www.google.com/search?q=weather+mke');
    expect(searchUrlFor('bing', 'weather mke')).toBe('https://www.bing.com/search?q=weather+mke');
    expect(searchUrlFor('duckduckgo', 'weather mke')).toBe('https://html.duckduckgo.com/html/?q=weather+mke');
  });
});

describe('parseSearchResults', () => {
  it('extracts Google organic results and unwraps tracking URLs', () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <div class="MjjYud">
            <div class="tF2Cxc">
              <a href="/url?q=https%3A%2F%2Fexample.com%2Fdocs&sa=U"><h3>Example Docs</h3></a>
              <cite>example.com › docs</cite>
              <div class="VwiC3b">Documentation for the example API. Read more</div>
            </div>
          </div>
        </body>
      </html>
    `;

    const parsed = parseSearchResults(html, 'https://www.google.com/search?q=example', 'google');

    expect(parsed.results).toEqual([
      {
        index: 1,
        title: 'Example Docs',
        url: 'https://example.com/docs',
        displayUrl: 'example.com › docs',
        snippet: 'Documentation for the example API.',
      },
    ]);
  });

  it('extracts Bing organic results and unwraps encoded click URLs', () => {
    const target = 'https://example.com/docs';
    const encoded = `a1${Buffer.from(target).toString('base64url')}`;
    const html = `
      <!doctype html>
      <html>
        <body>
          <ol>
            <li class="b_algo">
              <h2><a href="https://www.bing.com/ck/a?u=${encoded}&ntb=1">Example Docs</a></h2>
              <cite>https://example.com › docs</cite>
              <div class="b_caption"><p>Documentation for the example API.</p></div>
            </li>
          </ol>
        </body>
      </html>
    `;

    const parsed = parseSearchResults(html, 'https://www.bing.com/search?q=example', 'bing');

    expect(parsed.results).toEqual([
      {
        index: 1,
        title: 'Example Docs',
        url: target,
        displayUrl: 'https://example.com › docs',
        snippet: 'Documentation for the example API.',
      },
    ]);
  });

  it('extracts DuckDuckGo organic results from html results', () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <div class="result">
            <h2>
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&rut=abc">Example Docs</a>
            </h2>
            <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&rut=abc">example.com/docs</a>
            <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&rut=abc">Documentation for the example API.</a>
          </div>
        </body>
      </html>
    `;

    const parsed = parseSearchResults(html, 'https://html.duckduckgo.com/html/?q=example', 'duckduckgo');

    expect(parsed.results).toEqual([
      {
        index: 1,
        title: 'Example Docs',
        url: 'https://example.com/docs',
        displayUrl: 'example.com/docs',
        snippet: 'Documentation for the example API.',
      },
    ]);
  });
});
