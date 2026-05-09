import { describe, expect, it } from 'vitest';
import { selectMarkdownSection } from '../src/convert/section.js';

describe('selectMarkdownSection', () => {
  it('selects a heading and its nested content until the next peer heading', () => {
    const result = selectMarkdownSection(
      `# Guide

## Installation

Install it.

### npm

\`npm install\`

## Usage

Run it.
`,
      'installation',
    );

    expect(result.found).toBe(true);
    expect(result.markdown).toContain('## Installation');
    expect(result.markdown).toContain('### npm');
    expect(result.markdown).not.toContain('## Usage');
  });

  it('matches headings with markdown formatting', () => {
    const result = selectMarkdownSection('## [`createClient`](https://example.com)\n\nAPI details.\n', 'createClient');

    expect(result.found).toBe(true);
    expect(result.markdown).toContain('API details.');
  });

  it('keeps the original markdown when no section matches', () => {
    const markdown = '# Guide\n\nBody.\n';
    const result = selectMarkdownSection(markdown, 'missing');

    expect(result.found).toBe(false);
    expect(result.markdown).toBe(markdown);
  });
});
