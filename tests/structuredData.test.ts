import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendStructuredData, extractStructuredData } from '../src/convert/structuredData.js';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('structured data', () => {
  it('summarizes JSON-LD recipe data for LLM consumption', () => {
    const html = readFileSync(join(fixtures, 'structured-data.html'), 'utf8');
    const items = extractStructuredData(html, 'https://example.com/recipe/');

    expect(items).toEqual([
      expect.objectContaining({
        index: 1,
        type: 'Recipe, NewsArticle',
        name: 'Banana Banana Bread',
        description: 'A moist banana bread recipe.',
        authors: ['Shelley Albeluhn'],
        images: ['https://example.com/banana-bread.jpg'],
        prep_time: 'PT15M',
        cook_time: 'PT1H',
        total_time: 'PT1H15M',
        recipe_yield: '1 9x5-inch loaf',
        recipe_category: ['Breakfast', 'Brunch'],
        recipe_cuisine: ['American'],
        ingredients: ['2 cups all-purpose flour', '1 teaspoon baking soda', '0.25 teaspoon salt'],
        instructions: ['Preheat oven to 350 degrees F.', 'Mix ingredients and bake.'],
        rating: '4.8 (12000 reviews)',
      }),
    ]);
  });

  it('appends structured data as compact markdown', () => {
    const markdown = appendStructuredData('# Recipe\n', [
      {
        index: 1,
        type: 'Recipe',
        name: 'Banana Bread',
        ingredients: ['2 cups flour'],
        instructions: ['Mix.', 'Bake.'],
      },
    ]);

    expect(markdown).toContain('## Structured Data');
    expect(markdown).toContain('### 1. Recipe: Banana Bread');
    expect(markdown).toContain('**Ingredients:**');
    expect(markdown).toContain('- 2 cups flour');
    expect(markdown).toContain('1. Mix.');
    expect(markdown).toContain('2. Bake.');
  });
});
