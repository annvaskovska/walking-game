import { describe, expect, it } from 'vitest';
import { metresPerDegree } from '../geo/geo';
import { splitWay } from '../geo/pieces';
import {
  formatDistance, formatDuration, groupStreets, isRealWalk, localDay, nearbyUnlitStreets, streaks, weekBars,
} from './stats';
import type { Piece, WalkRecord } from './types';

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h, 0).getTime();
const walk = (startedAt: number, distanceM = 1500, newPieces = 3): WalkRecord => ({
  id: String(startedAt), startedAt, endedAt: startedAt + 1_800_000, distanceM, durationMs: 1_800_000,
  newPieces, newLenM: newPieces * 20, newStreets: [], visitedPark: false, stamps: [],
});

describe('streaks', () => {
  it('counts consecutive days ending today', () => {
    const walks = [walk(at(2026, 11, 12)), walk(at(2026, 11, 13)), walk(at(2026, 11, 14, 8))];
    expect(streaks(walks, at(2026, 11, 14, 20))).toEqual({ current: 3, best: 3 });
  });

  it("doesn't break the streak before you've walked today", () => {
    const walks = [walk(at(2026, 11, 12)), walk(at(2026, 11, 13))];
    expect(streaks(walks, at(2026, 11, 14, 9)).current).toBe(2);
  });

  it('resets after a missed day but remembers the best run', () => {
    const walks = [10, 11, 12, 13, 15].map((d) => walk(at(2026, 11, d)));
    expect(streaks(walks, at(2026, 11, 17))).toEqual({ current: 0, best: 4 });
    expect(streaks(walks, at(2026, 11, 15)).current).toBe(1);
  });

  it('counts several walks on one day once, and ignores trivial walks', () => {
    const walks = [walk(at(2026, 11, 14, 7)), walk(at(2026, 11, 14, 19)), walk(at(2026, 11, 13), 20, 0)];
    expect(streaks(walks, at(2026, 11, 14))).toEqual({ current: 1, best: 1 });
  });

  it('crosses month boundaries', () => {
    const walks = [walk(at(2026, 10, 31)), walk(at(2026, 11, 1))];
    expect(streaks(walks, at(2026, 11, 1)).current).toBe(2);
    expect(localDay(at(2026, 11, 1)) - localDay(at(2026, 10, 31))).toBe(1);
  });
});

describe('isRealWalk', () => {
  it('needs 100 m or a newly lit piece', () => {
    expect(isRealWalk({ distanceM: 99, newPieces: 0 })).toBe(false);
    expect(isRealWalk({ distanceM: 100, newPieces: 0 })).toBe(true);
    expect(isRealWalk({ distanceM: 30, newPieces: 1 })).toBe(true);
  });
});

describe('weekBars', () => {
  it('sums distance per day from Monday to Sunday', () => {
    // 2026-11-14 is a Saturday.
    const now = at(2026, 11, 14, 18);
    const bars = weekBars([walk(at(2026, 11, 9), 1000), walk(at(2026, 11, 14), 500), walk(at(2026, 11, 14), 700), walk(at(2026, 11, 8), 9999)], now);
    expect(bars.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(bars[0].distanceM).toBe(1000);
    expect(bars[5].distanceM).toBe(1200);
    expect(bars[5].isToday).toBe(true);
    expect(bars.reduce((s, b) => s + b.distanceM, 0)).toBe(2200); // last Sunday not included
  });
});

describe('groupStreets & nudges', () => {
  const lat0 = 52.37, lon0 = 4.88;
  const m = metresPerDegree(lat0);
  const pts = (...p: [number, number][]) => p.flatMap(([x, y]) => [lon0 + x / m.lon, lat0 + y / m.lat]);
  const pieces: Piece[] = [
    ...splitWay({ id: 1, name: 'Rozengracht', highway: 'tertiary', coords: pts([0, 0], [100, 0]) }),
    ...splitWay({ id: 2, name: 'Rozengracht', highway: 'tertiary', coords: pts([100, 0], [160, 0]) }),
    ...splitWay({ id: 3, name: 'Bloemstraat', highway: 'residential', coords: pts([0, 300], [80, 300]) }),
    ...splitWay({ id: 4, name: 'Laurierstraat', highway: 'residential', coords: pts([0, -900], [80, -900]) }),
    ...splitWay({ id: 5, name: null, highway: 'footway', coords: pts([0, 10], [40, 10]) }),
    ...splitWay({ id: 6, name: 'Verweg', highway: 'residential', coords: pts([0, 5000], [80, 5000]) }),
  ];

  it('groups pieces of several ways by street name, leaving out paths', () => {
    const lit = new Set(['1:0', '1:1', '2:0']);
    const g = groupStreets(pieces, (id) => lit.has(id));
    expect([...g.keys()].sort()).toEqual(['Bloemstraat', 'Laurierstraat', 'Rozengracht', 'Verweg']);
    const roz = g.get('Rozengracht')!;
    expect(roz.pieces).toBe(8);
    expect(roz.lenM).toBeCloseTo(160, 0);
    expect(roz.litPieces).toBe(3);
    expect(roz.litLenM).toBeCloseTo(60, 0);
  });

  it('suggests the nearest unlit named streets', () => {
    const nudges = nearbyUnlitStreets(pieces, (n) => n === 'Rozengracht', lon0, lat0);
    expect(nudges.map((n) => n.name)).toEqual(['Bloemstraat', 'Laurierstraat']);
    expect(nudges[0].distM).toBeCloseTo(300, -1);
  });
});

describe('formatting', () => {
  it('formats distances and durations', () => {
    expect(formatDistance(420)).toBe('420 m');
    expect(formatDistance(2345)).toBe('2.35 km');
    expect(formatDistance(12_345)).toBe('12.3 km');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
});
