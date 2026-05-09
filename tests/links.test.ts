import { describe, expect, it } from 'vitest';
import { appendLinksTable, rewriteLinks } from '../src/convert/links.js';

describe('links', () => {
  it('rewrites relative links and builds references', () => {
    const result = rewriteLinks('<p><a href="/docs">Docs</a></p>', 'https://example.com/base/');

    expect(result.html).toContain('https://example.com/docs');
    expect(result.links).toEqual([{ index: 1, text: 'Docs', url: 'https://example.com/docs' }]);
  });

  it('appends a links table', () => {
    const markdown = appendLinksTable('Body\n', [{ index: 1, text: 'Docs', url: 'https://example.com/docs' }]);

    expect(markdown).toContain('## Links');
    expect(markdown).toContain('| 1 | Docs | https://example.com/docs |');
  });
});
