import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendPageResources, extractPageResources } from '../src/convert/resources.js';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('page resources', () => {
  it('extracts full-page links and images with context', () => {
    const html = readFileSync(join(fixtures, 'resources.html'), 'utf8');
    const resources = extractPageResources(html, 'https://example.com/menu/');

    expect(resources.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ context: 'header/logo', text: "Oscar's Frozen Custard logo", url: 'https://example.com/' }),
        expect.objectContaining({ context: 'navigation', text: 'Menu', url: 'https://example.com/menu/' }),
        expect.objectContaining({ context: 'footer', text: 'Policies', url: 'https://example.com/policies/' }),
      ]),
    );
    expect(resources.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          context: 'header/logo',
          label: "[logo] Oscar's Frozen Custard logo",
          url: 'https://example.com/logo.png',
          linked_url: 'https://example.com/',
        }),
        expect.objectContaining({ context: 'article', label: 'Oscar Burger', url: 'https://example.com/burger.jpg' }),
        expect.objectContaining({ context: 'article', label: 'Lazy burger', url: 'https://example.com/lazy-burger.jpg', source: 'data' }),
        expect.objectContaining({ context: 'article', label: 'Responsive lazy burger', url: 'https://example.com/large.jpg', source: 'data' }),
        expect.objectContaining({ context: 'article', label: 'Hero burger', url: 'https://example.com/hero-large.jpg', source: 'source' }),
        expect.objectContaining({ context: 'metadata', label: 'icon', url: 'https://example.com/favicon.ico' }),
        expect.objectContaining({ context: 'metadata', label: 'og:image', url: 'https://example.com/share-card.jpg' }),
      ]),
    );
  });

  it('appends resources as markdown tables', () => {
    const markdown = appendPageResources('# Page\n', {
      links: [{ index: 1, context: 'navigation', text: 'Menu', url: 'https://example.com/menu/' }],
      images: [
        {
          index: 1,
          context: 'header/logo',
          label: '[logo] Site logo',
          url: 'https://example.com/logo.png',
          linked_url: 'https://example.com/',
          source: 'img',
        },
      ],
    });

    expect(markdown).toContain('## Page Resources');
    expect(markdown).toContain('| 1 | navigation | Menu | https://example.com/menu/ |');
    expect(markdown).toContain('| 1 | header/logo | [logo] Site logo | https://example.com/logo.png | https://example.com/ |');
  });
});
