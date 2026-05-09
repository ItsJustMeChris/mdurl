import { describe, expect, it } from 'vitest';
import { exitCodeForKind } from '../src/errors.js';

describe('exitCodeForKind', () => {
  it('matches the documented exit-code contract', () => {
    expect(exitCodeForKind('http')).toBe(1);
    expect(exitCodeForKind('timeout')).toBe(2);
    expect(exitCodeForKind('network')).toBe(3);
    expect(exitCodeForKind('parse')).toBe(4);
    expect(exitCodeForKind('browser')).toBe(5);
  });
});
