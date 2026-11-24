import { describe, expect, it } from 'vitest';
import { longestStraight, nameLines } from './names';

describe('longestStraight', () => {
  it('writes a name on the middle of the longest straight stretch, kept upright', () => {
    // A short bit east, then a long straight run south-west in three segments, then a bend.
    const line = [4.88, 52.37, 4.8801, 52.37, 4.8797, 52.3698, 4.8793, 52.3696, 4.8789, 52.3694, 4.8789, 52.3699];
    const { at, r } = longestStraight(line);
    expect(at[0]).toBeCloseTo((4.8801 + 4.8789) / 2, 6);
    expect(at[1]).toBeCloseTo((52.37 + 52.3694) / 2, 6);
    // It climbs 67 m over 82 m east: read left to right, the text turns 39° counterclockwise.
    expect(r).toBeCloseTo(-39.3, 1);
  });
});

describe('nameLines', () => {
  const piece = (way: number, coords: number[]) => ({ way, idx: 0, name: 'Prinsengracht', kind: 'road', coords });

  it('writes a street once where you walked both sides of its canal, and again far along it', () => {
    const names = nameLines([
      piece(1, [4.88, 52.37, 4.882, 52.37]),
      // The other side, 33 m north and shorter: no second name.
      piece(2, [4.88, 52.3703, 4.881, 52.3703]),
      // A kilometre on: a name of its own.
      piece(3, [4.895, 52.37, 4.896, 52.37]),
    ]);
    expect(names.map((f) => f.geometry.coordinates)).toEqual([
      [4.881, 52.37],
      [4.8955, 52.37],
    ]);
  });
});
