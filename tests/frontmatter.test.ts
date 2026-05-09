import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { renderFrontmatter } from '../src/output/frontmatter.js';
import type { DocumentMetadata } from '../src/types.js';

describe('renderFrontmatter', () => {
  it('emits parseable YAML frontmatter', () => {
    const metadata: DocumentMetadata = {
      url: 'https://example.com/',
      fetched_at: '2026-05-09T00:00:00.000Z',
      status: 200,
      render_mode: 'http',
      elapsed_ms: 12,
      word_count: 2,
      content_type: 'text/html',
      title: 'Example Domain',
    };

    const output = renderFrontmatter(metadata, '# Example\n');
    const yaml = output.split('---\n')[1];

    expect(parse(yaml).url).toBe('https://example.com/');
    expect(output).toContain('# Example');
  });
});
