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
        expect.objectContaining({ context: 'navigation', text: 'Cart', url: 'https://example.com/cart/' }),
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
    expect(resources.forms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          context: 'header',
          label: 'Site search',
          action: 'https://example.com/search',
          method: 'get',
          fields: [
            expect.objectContaining({
              name: 'q',
              type: 'search',
              label: 'Search',
              required: true,
              placeholder: 'Search menu',
            }),
          ],
          buttons: ['Search'],
        }),
        expect.objectContaining({
          context: 'article',
          label: 'Contact form',
          action: 'https://example.com/contact',
          method: 'post',
          fields: expect.arrayContaining([
            expect.objectContaining({ name: 'email', type: 'email', label: 'Email', required: true }),
            expect.objectContaining({ name: 'message', type: 'textarea', label: 'Message', placeholder: 'How can we help?' }),
            expect.objectContaining({ name: 'topic', type: 'select', options: ['General question', 'Catering'] }),
          ]),
          buttons: ['Send'],
        }),
      ]),
    );
    expect(resources.embeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          context: 'article',
          type: 'iframe',
          label: 'Location map',
          url: 'https://example.com/map.html',
          width: '600',
          height: '400',
        }),
        expect.objectContaining({
          context: 'article',
          type: 'video',
          label: 'video embed',
          url: 'https://example.com/tour.mp4',
        }),
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
      forms: [
        {
          index: 1,
          context: 'header',
          label: 'Site search',
          action: 'https://example.com/search',
          method: 'get',
          fields: [{ name: 'q', type: 'search', label: 'Search', required: true }],
          buttons: ['Search'],
        },
      ],
      embeds: [
        {
          index: 1,
          context: 'article',
          label: 'Location map',
          url: 'https://example.com/map.html',
          type: 'iframe',
          width: '600',
          height: '400',
        },
      ],
    });

    expect(markdown).toContain('## Page Resources');
    expect(markdown).toContain('### Navigation');
    expect(markdown).toContain('| 1 | navigation | Menu | https://example.com/menu/ |');
    expect(markdown).toContain('### Links');
    expect(markdown).toContain('| 1 | header/logo | [logo] Site logo | img | https://example.com/logo.png | https://example.com/ |');
    expect(markdown).toContain('### Forms');
    expect(markdown).toContain('#### 1. Site search');
    expect(markdown).toContain('| q | search | yes | Search |  |');
    expect(markdown).toContain('### Embeds');
    expect(markdown).toContain('| 1 | article | iframe | Location map | https://example.com/map.html | 600x400 |');
  });
});
