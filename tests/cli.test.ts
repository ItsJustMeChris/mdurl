import { describe, expect, it } from 'vitest';
import { mapConcurrent } from '../src/cli.js';

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

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
