import { describe, expect, it } from 'vitest';
import { cubicBezier } from './puckLayer';

describe('cubicBezier', () => {
  it('matches CSS timing functions', () => {
    const easeInOut = cubicBezier(0.42, 0, 0.58, 1);
    expect(easeInOut(0)).toBeCloseTo(0, 5);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
    expect(easeInOut(1)).toBeCloseTo(1, 5);
    expect(easeInOut(0.25)).toBeCloseTo(0.1291, 3);
    // The pop springs past its rest and back.
    const pop = cubicBezier(0.3, 1.7, 0.5, 1);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => pop(i / 100)));
    expect(peak).toBeGreaterThan(1.1);
    expect(pop(1)).toBeCloseTo(1, 5);
  });
});
