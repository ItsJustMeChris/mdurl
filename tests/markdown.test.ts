import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { htmlToMarkdown } from '../src/convert/markdown.js';
import { extractContent } from '../src/extract/readability.js';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('htmlToMarkdown', () => {
  it('converts headings and absolute links', () => {
    const html = readFileSync(join(fixtures, 'static.html'), 'utf8');
    const extracted = extractContent(html, 'https://example.com/', { full: true });
    const result = htmlToMarkdown(extracted.html, 'https://example.com/', { includeLinks: true });

    expect(result.markdown).toContain('# Example Domain');
    expect(result.markdown).toContain('[More information](https://example.com/more)');
    expect(result.markdown).toContain('## Links');
  });

  it('preserves GFM tables', () => {
    const html = readFileSync(join(fixtures, 'gfm-tables.html'), 'utf8');
    const extracted = extractContent(html, 'https://example.com/', { full: true });
    const result = htmlToMarkdown(extracted.html, 'https://example.com/', { includeLinks: false });

    expect(result.markdown).toContain('| Task | Done |');
    expect(result.markdown).toContain('| Build | yes |');
  });

  it('converts row-header tables to readable markdown tables', () => {
    const result = htmlToMarkdown(
      `
        <table>
          <tbody>
            <tr>
              <th scope="row"><a href="/content">Content categories</a></th>
              <td>None.</td>
            </tr>
            <tr>
              <th scope="row">DOM interface</th>
              <td><code>HTMLElement</code></td>
            </tr>
          </tbody>
        </table>
      `,
      'https://example.com/',
      { includeLinks: false },
    );

    expect(result.markdown).toContain('| Field | Value |');
    expect(result.markdown).toContain('| [Content categories](https://example.com/content) | None. |');
    expect(result.markdown).toContain('| DOM interface | `HTMLElement` |');
    expect(result.markdown).not.toContain('<table>');
  });

  it('promotes standalone language labels into fenced code info strings', () => {
    const result = htmlToMarkdown(
      `
        <p>Use fetch like this:</p>
        <p>js</p>
        <pre><code>const response = await fetch("/api");</code></pre>
      `,
      'https://example.com/',
      { includeLinks: false },
    );

    expect(result.markdown).toContain('```js\nconst response = await fetch("/api");');
    expect(result.markdown).not.toContain('\njs\n\n```');
  });

  it('preserves code block languages from classes and syntax highlighter spans', () => {
    const result = htmlToMarkdown(
      `
        <pre><code class="language-ts"><span>const value: string = "typed";</span></code></pre>
        <pre class="highlight-source-shell"><code>npm test</code></pre>
      `,
      'https://example.com/',
      { includeLinks: false },
    );

    expect(result.markdown).toContain('```ts\nconst value: string = "typed";');
    expect(result.markdown).toContain('```sh\nnpm test');
  });
});
