import { describe, expect, it } from 'vitest';
import { metresPerDegree } from '../geo/geo';
import { lightRadius, newFilterState, stepFilter, type FilterState, type Verdict } from './gpsFilter';
import type { Fix } from './types';

const lat0 = 52.37, lon0 = 4.88;
const m = metresPerDegree(lat0);
const fix = (x: number, y: number, tSec: number, acc = 8, speed: number | null = null): Fix => ({
  lon: lon0 + x / m.lon, lat: lat0 + y / m.lat, acc, t: tSec * 1000, speed,
});

function run(fixes: Fix[]): { state: FilterState; verdicts: Verdict[] } {
  let state = newFilterState();
  const verdicts: Verdict[] = [];
  for (const f of fixes) {
    const r = stepFilter(state, f);
    state = r.state;
    verdicts.push(r.verdict);
  }
  return { state, verdicts };
}

describe('lightRadius', () => {
  it('is 0.8 × accuracy, clamped to 12–25 m', () => {
    expect(lightRadius(5)).toBe(12);
    expect(lightRadius(20)).toBe(16);
    expect(lightRadius(30)).toBe(24);
    expect(lightRadius(60)).toBe(25);
  });
});

describe('stepFilter', () => {
  it('starts a chain on the first good fix, then lights walked segments', () => {
    const { verdicts } = run([fix(0, 0, 0), fix(7, 0, 5), fix(14, 0, 10)]);
    expect(verdicts[0]).toEqual({ kind: 'anchor', reason: 'first' });
    expect(verdicts[1].kind).toBe('walk');
    expect(verdicts[2].kind).toBe('walk');
    if (verdicts[1].kind === 'walk') {
      expect(verdicts[1].distM).toBeCloseTo(7, 0);
      expect(verdicts[1].radiusM).toBe(12);
    }
  });

  it('ignores fixes with accuracy worse than 35 m', () => {
    const { verdicts, state } = run([fix(0, 0, 0), fix(5, 0, 4, 48)]);
    expect(verdicts[1]).toEqual({ kind: 'reject', reason: 'accuracy' });
    expect(state.anchor?.t).toBe(0);
  });

  it('uses the worse accuracy of the two ends for the radius', () => {
    const { verdicts } = run([fix(0, 0, 0, 30), fix(10, 0, 8, 5)]);
    const v = verdicts[1];
    expect(v.kind).toBe('walk');
    if (v.kind === 'walk') expect(v.radiusM).toBe(24);
  });

  it('treats tiny moves as standing still (no distance)', () => {
    const { verdicts } = run([fix(0, 0, 0), fix(1.5, 0, 1), fix(2, 1, 2)]);
    expect(verdicts.slice(1).every((v) => v.kind === 'still')).toBe(true);
  });

  it('drops a single GPS glitch and keeps walking from the last good point', () => {
    const { verdicts } = run([fix(0, 0, 0), fix(6, 0, 4), fix(6, 300, 5), fix(12, 0, 8)]);
    expect(verdicts[2]).toEqual({ kind: 'reject', reason: 'jump' });
    expect(verdicts[3].kind).toBe('walk');
    if (verdicts[3].kind === 'walk') expect(verdicts[3].from.t).toBe(4000);
  });

  it('trusts the new place after a streak of glitches, without lighting the gap', () => {
    const fixes = [fix(0, 0, 0)];
    for (let i = 1; i <= 5; i++) fixes.push(fix(1000 + i * 2, 0, i));
    const { verdicts } = run(fixes);
    expect(verdicts.slice(1, 5).every((v) => v.kind === 'reject')).toBe(true);
    expect(verdicts[5]).toEqual({ kind: 'anchor', reason: 'reset' });
  });

  it('calls sustained speed above 4 m/s a vehicle and lights nothing', () => {
    // A bus at 6 m/s, one fix per second.
    const fixes = Array.from({ length: 25 }, (_, i) => fix(i * 6, 0, i, 10));
    const { verdicts } = run(fixes);
    const kinds = verdicts.map((v) => v.kind);
    expect(kinds.slice(-10).every((k) => k === 'vehicle')).toBe(true);
    // Only the first couple of seconds could pass as walking.
    expect(kinds.filter((k) => k === 'walk').length).toBeLessThanOrEqual(3);
  });

  it('detects a vehicle immediately from Doppler speed', () => {
    const { verdicts } = run([fix(0, 0, 0), fix(9, 0, 1, 10, 9)]);
    expect(verdicts[1].kind).toBe('vehicle');
  });

  it('keeps a brisk walk (1.8 m/s) as walking', () => {
    const fixes = Array.from({ length: 40 }, (_, i) => fix(i * 1.8 * 3, 0, i * 3, 8, 1.8));
    const { verdicts } = run(fixes);
    expect(verdicts.slice(1).every((v) => v.kind === 'walk')).toBe(true);
  });

  it('does not join far-apart fixes after a long gap', () => {
    const { verdicts } = run([fix(0, 0, 0), fix(400, 0, 300)]);
    expect(verdicts[1]).toEqual({ kind: 'anchor', reason: 'gap' });
  });

  it('rejects duplicate timestamps', () => {
    const { verdicts } = run([fix(0, 0, 10), fix(5, 0, 10)]);
    expect(verdicts[1]).toEqual({ kind: 'reject', reason: 'duplicate' });
  });
});
