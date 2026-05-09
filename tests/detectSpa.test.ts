import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectSpa } from '../src/fetch/detectSpa.js';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('detectSpa', () => {
  it('detects a sparse client-rendered shell', () => {
    const html = readFileSync(join(fixtures, 'spa-shell.html'), 'utf8');
    const result = detectSpa({ html, status: 200 });

    expect(result.isSpa).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('does not flag a normal static page', () => {
    const html = readFileSync(join(fixtures, 'static.html'), 'utf8');
    const result = detectSpa({ html, status: 200 });

    expect(result.isSpa).toBe(false);
  });
});
