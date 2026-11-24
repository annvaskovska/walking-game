import { describe, expect, it } from 'vitest';
import { makeTooth } from './fogLayer';

describe('makeTooth', () => {
  it('leaves about a quarter of the paper bare, in specks, the same on every load', () => {
    const t = makeTooth(256);
    const bare = t.filter((v) => v < 128).length / t.length;
    expect(bare).toBeGreaterThan(0.12);
    expect(bare).toBeLessThan(0.4);
    expect(Math.max(...t)).toBe(255);
    expect(makeTooth(256)).toEqual(t);
  });
});
