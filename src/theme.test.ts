import { describe, expect, it } from 'vitest';
import { paperTheme, pencilKey, pencilOf } from './theme';

describe('pencilOf', () => {
  it('gives a street the same pencil every time, always one in the box', () => {
    const n = paperTheme.pencils.length;
    expect(pencilOf('Prinsengracht')).toBe(pencilOf('Prinsengracht'));
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const k = pencilOf(`Straat ${i}`);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(n);
      seen.add(k);
    }
    // Every pencil in the box gets used.
    expect(seen.size).toBe(n);
  });

  it('keys a street by its name, and an unnamed one by its way', () => {
    expect(pencilKey({ name: 'Bloemgracht', way: 7 })).toBe('Bloemgracht');
    expect(pencilKey({ name: null, way: 7 })).toBe('way 7');
  });
});
