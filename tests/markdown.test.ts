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
});
