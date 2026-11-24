import { describe, expect, it } from 'vitest';
import { cubicBezier, strokeAt } from './puckLayer';

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

describe('strokeAt', () => {
  it('colors left and right, his top leading, with no jump where a stroke turns', () => {
    const [x0, a0] = strokeAt(0);
    expect(x0).toBeCloseTo(-3, 5);
    expect(a0).toBeCloseTo(0, 5);
    // Halfway to the right he passes over you, leaning into the stroke; halfway back, the other way.
    expect(strokeAt(110)[0]).toBeCloseTo(0, 3);
    expect(strokeAt(110)[1]).toBeCloseTo(7, 3);
    expect(strokeAt(220)[0]).toBeCloseTo(3, 3);
    expect(strokeAt(330)[1]).toBeCloseTo(-7, 3);
    let jump = 0;
    for (let ms = 1; ms < 1000; ms++) {
      const [x, a] = strokeAt(ms), [px, pa] = strokeAt(ms - 1);
      jump = Math.max(jump, Math.abs(x - px), Math.abs(a - pa) / 10);
    }
    expect(jump).toBeLessThan(0.15);
  });
});
