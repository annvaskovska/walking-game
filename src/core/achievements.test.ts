import { describe, expect, it } from 'vitest';
import { isEarlyWalk, isNightWalk, newlyEarned, STAMPS, type StampContext } from './achievements';
import type { WalkRecord } from './types';

const at = (d: number, h: number) => new Date(2026, 10, d, h, 30).getTime();
const walk = (startedAt: number, extra: Partial<WalkRecord> = {}): WalkRecord => ({
  id: String(startedAt), startedAt, endedAt: startedAt + 3_600_000, distanceM: 2000, durationMs: 3_600_000,
  newPieces: 5, newLenM: 100, newStreets: [], visitedPark: false, stamps: [], ...extra,
});
const ctx = (over: Partial<StampContext> = {}): StampContext => ({
  streetsMet: 0, piecesLit: 0, litLenM: 0, walks: [], now: at(14, 22), ...over,
});
const earnedIds = (c: StampContext, already: string[] = []) => newlyEarned(c, new Set(already)).map((s) => s.id);

describe('stamps', () => {
  it('has unique ids', () => {
    expect(new Set(STAMPS.map((s) => s.id)).size).toBe(STAMPS.length);
  });

  it('awards nothing to a fresh install', () => {
    expect(earnedIds(ctx())).toEqual([]);
  });

  it('awards First Light for the first lit piece', () => {
    expect(earnedIds(ctx({ piecesLit: 1 }))).toEqual(['first-light']);
  });

  it('awards street milestones at 10, 50 and 100 streets', () => {
    expect(earnedIds(ctx({ piecesLit: 9, streetsMet: 9 }))).toEqual(['first-light']);
    expect(earnedIds(ctx({ piecesLit: 90, streetsMet: 10 }), ['first-light'])).toEqual(['streets-10']);
    expect(earnedIds(ctx({ piecesLit: 900, streetsMet: 100 }), ['first-light'])).toEqual(['streets-10', 'streets-50', 'streets-100']);
  });

  it('awards 5 km of lit streets', () => {
    expect(earnedIds(ctx({ litLenM: 4999 }))).not.toContain('new-5km');
    expect(earnedIds(ctx({ litLenM: 5000 }))).toContain('new-5km');
    const s = STAMPS.find((x) => x.id === 'new-5km')!;
    expect(s.progress!(ctx({ litLenM: 2350 }))).toEqual([2.3, 5]);
  });

  it('knows night and early walks by local start time', () => {
    expect(isNightWalk(walk(at(14, 20)))).toBe(true);
    expect(isNightWalk(walk(at(14, 2)))).toBe(true);
    expect(isNightWalk(walk(at(14, 19)))).toBe(false);
    expect(isEarlyWalk(walk(at(14, 7)))).toBe(true);
    expect(isEarlyWalk(walk(at(14, 8)))).toBe(false);
    expect(earnedIds(ctx({ walks: [walk(at(14, 21))] }))).toEqual(['night-owl']);
    expect(earnedIds(ctx({ walks: [walk(at(14, 6))] }))).toEqual(['early-bird']);
  });

  it('ignores trivial walks for time-of-day stamps', () => {
    expect(earnedIds(ctx({ walks: [walk(at(14, 21), { distanceM: 20, newPieces: 0 })] }))).toEqual([]);
  });

  it('awards 3- and 7-day streaks', () => {
    const three = [12, 13, 14].map((d) => walk(at(d, 12)));
    expect(earnedIds(ctx({ walks: three }))).toEqual(['streak-3']);
    const seven = [8, 9, 10, 11, 12, 13, 14].map((d) => walk(at(d, 12)));
    expect(earnedIds(ctx({ walks: seven }))).toEqual(['streak-3', 'streak-7']);
  });

  it('keeps a streak stamp even after the streak breaks', () => {
    const old = [1, 2, 3].map((d) => walk(at(d, 12)));
    expect(earnedIds(ctx({ walks: old, now: at(14, 12) }))).toContain('streak-3');
  });

  it('awards a park walk', () => {
    expect(earnedIds(ctx({ walks: [walk(at(14, 12), { visitedPark: true })] }))).toEqual(['park']);
  });

  it('never re-awards a stamp', () => {
    expect(earnedIds(ctx({ piecesLit: 3 }), ['first-light'])).toEqual([]);
  });
});
