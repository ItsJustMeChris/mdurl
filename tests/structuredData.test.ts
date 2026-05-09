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
      expect.objectContaining({
        index: 2,
        type: 'FAQPage',
        name: 'Banana Bread FAQ',
        questions: [
          {
            question: 'Can I freeze banana bread?',
            answer: 'Yes. Wrap it tightly and freeze for up to 3 months.',
          },
          {
            question: 'How ripe should bananas be?',
            answer: 'Use very ripe bananas with brown spots.',
          },
        ],
      }),
      expect.objectContaining({
        index: 3,
        type: 'MusicEvent',
        name: 'Summer Music Festival',
        description: 'A live outdoor concert.',
        start_date: '2026-07-21T19:00:00-05:00',
        end_date: '2026-07-21T23:00:00-05:00',
        event_status: 'EventScheduled',
        attendance_mode: 'OfflineEventAttendanceMode',
        location: 'Example Amphitheater - 123 Music Way, Milwaukee, WI, 53202, US',
        organizers: ['Example Events - https://example.com/events'],
        performers: ['The Headliners', 'Opening Band'],
        offers: ['USD 45.00 - InStock - https://example.com/tickets'],
      }),
    ]);
  });

  it('appends structured data as compact markdown', () => {
    const markdown = appendStructuredData('# Recipe\n', [
      {
        index: 1,
        type: 'Recipe',
        name: 'Banana Bread',
        start_date: '2026-07-21T19:00:00-05:00',
        location: 'Example Amphitheater',
        ingredients: ['2 cups flour'],
        instructions: ['Mix.', 'Bake.'],
        questions: [{ question: 'Can I freeze it?', answer: 'Yes.' }],
      },
    ]);

    expect(markdown).toContain('## Structured Data');
    expect(markdown).toContain('### 1. Recipe: Banana Bread');
    expect(markdown).toContain('- **Start:** 2026-07-21T19:00:00-05:00');
    expect(markdown).toContain('- **Location:** Example Amphitheater');
    expect(markdown).toContain('**Ingredients:**');
    expect(markdown).toContain('- 2 cups flour');
    expect(markdown).toContain('1. Mix.');
    expect(markdown).toContain('2. Bake.');
    expect(markdown).toContain('**Questions:**');
    expect(markdown).toContain('1. **Can I freeze it?**');
    expect(markdown).toContain('   Yes.');
  });
});
