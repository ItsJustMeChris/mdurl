import { describe, expect, it } from 'vitest';
import { extractHeadMetadata } from '../src/extract/head.js';

describe('extractHeadMetadata', () => {
  it('extracts description, site name, and canonical URL', () => {
    const metadata = extractHeadMetadata(
      `
        <!doctype html>
        <html>
          <head>
            <title>Example Page</title>
            <meta name="description" content="A concise page summary.">
            <meta property="og:site_name" content="Example Site">
            <link rel="canonical" href="/canonical-page">
          </head>
        </html>
      `,
      'https://example.com/original',
    );

    expect(metadata).toEqual({
      title: 'Example Page',
      description: 'A concise page summary.',
      siteName: 'Example Site',
      canonicalUrl: 'https://example.com/canonical-page',
    });
  });
});
