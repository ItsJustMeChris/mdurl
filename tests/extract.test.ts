import { describe, expect, it } from 'vitest';
import { extractContent, shouldUseCleanFallback } from '../src/extract/readability.js';

describe('shouldUseCleanFallback', () => {
  it('falls back when Readability captures a small menu fragment', () => {
    const readableHtml = `
      <article>
        <h1>Menu</h1>
        <h3>Toppings:</h3>
        <p>Pecans 1.75 Cashews 1.75 Whipped Cream .50</p>
      </article>
    `;
    const readableText = 'Menu Toppings: Pecans 1.75 Cashews 1.75 Whipped Cream .50';
    const cleanedHtml = Array.from(
      { length: 10 },
      (_, index) => `
        <section>
          <h2>Menu Section ${index}</h2>
          <h4>Item ${index}A</h4><p>$${index}.29</p>
          <h4>Item ${index}B</h4><p>$${index}.79</p>
        </section>
      `,
    ).join('');
    const cleanedText = `${cleanedHtml.replace(/<[^>]+>/g, ' ')} ${'full menu text '.repeat(80)}`;

    expect(shouldUseCleanFallback(readableHtml, readableText, cleanedHtml, cleanedText)).toBe(true);
  });

  it('keeps concise Readability output when the cleaned page lacks missed content structure', () => {
    const readableHtml = '<article><h1>Short Article</h1><p>A concise article.</p></article>';
    const readableText = 'Short Article A concise article.';
    const cleanedHtml = `<main>${readableHtml}<footer>${'footer link '.repeat(200)}</footer></main>`;
    const cleanedText = `Short Article A concise article. ${'footer link '.repeat(200)}`;

    expect(shouldUseCleanFallback(readableHtml, readableText, cleanedHtml, cleanedText)).toBe(false);
  });
});

describe('extractContent', () => {
  it('adds the page title as an H1 when Readability starts at section headings', () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>Using the Fetch API - Web APIs | MDN</title></head>
        <body>
          <article>
            <h2>Making a request</h2>
            <p>${'Fetch API documentation content. '.repeat(20)}</p>
          </article>
        </body>
      </html>
    `;

    const extracted = extractContent(html, 'https://example.com/docs', { full: false });

    expect(extracted.html).toContain('<h1>Using the Fetch API - Web APIs</h1>');
    expect(extracted.html).toContain('<h2>Making a request</h2>');
  });
});
