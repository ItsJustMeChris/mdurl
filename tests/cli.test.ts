import { describe, expect, it } from 'vitest';
import { buildProgram, mapConcurrent } from '../src/cli.js';

describe('mapConcurrent', () => {
  it('preserves result order while capping active work', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapConcurrent([30, 10, 20, 5], 2, async (delayMs, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(delayMs);
      active -= 1;
      return index;
    });

    expect(results).toEqual([0, 1, 2, 3]);
    expect(maxActive).toBe(2);
  });
});

describe('buildProgram', () => {
  it('exposes search as a subcommand instead of a root option', () => {
    const program = buildProgram();
    const searchCommand = program.commands.find((command) => command.name() === 'search');

    expect(searchCommand).toBeDefined();
    expect(program.helpInformation()).not.toContain('--search');
    expect(searchCommand?.helpInformation()).toContain('--engine <name>');
  });

  it('parses search options after the query terms', async () => {
    const program = buildProgram();
    const searchCommand = program.commands.find((command) => command.name() === 'search');
    let parsed:
      | {
          terms: string[];
          options: { engine?: string; maxBytes?: number };
        }
      | undefined;

    searchCommand?.action((terms: string[], options: { engine?: string; maxBytes?: number }) => {
      parsed = { terms, options };
    });

    await program.parseAsync(
      ['node', 'mdurl', 'search', 'weather', 'mke', '--engine', 'bing', '--max-bytes', '100'],
      { from: 'node' },
    );

    expect(parsed).toEqual({
      terms: ['weather', 'mke'],
      options: expect.objectContaining({ engine: 'bing', maxBytes: 100 }),
    });
  });
});

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
