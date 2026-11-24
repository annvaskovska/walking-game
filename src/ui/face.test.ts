import { describe, expect, it } from 'vitest';
import { mrInner } from './art';
import { faceY, marksSVG, type Moment, poseAt, restPose } from './face';

const fy = faceY(1);
const at = (kind: Moment['kind'], t: number, more: Partial<Moment> = {}) =>
  poseAt({ kind, t, now: t, fy, sx: 0, look: null, calm: false, ...more });
const svg = (m: Moment['kind'], t: number, more?: Partial<Moment>) => marksSVG(at(m, t, more).face);

describe('his face', () => {
  it('is the same at rest on the cover and the fridge as on the walk', () => {
    expect(mrInner(1)).toContain(marksSVG(restPose(1).face));
    expect(marksSVG(restPose(1).face)).toBe(svg('still', 0, { calm: true }));
  });

  it('shows stars for a new street, hearts for a place, spirals for a tap', () => {
    expect(svg('claim', 0.5)).toContain('#ffd02e');
    expect(svg('spot', 0.5)).toContain('#ff5a6e');
    expect(svg('tap', 0.5)).toContain('fill="#fff" stroke="#000" stroke-width="0.9"');
  });

  it('falls asleep standing still, but not while a finger is near', () => {
    expect(at('still', 3).asleep).toBe(false);
    expect(at('still', 6).asleep).toBe(true);
    expect(at('still', 6, { look: { x: 1, y: 0 } }).asleep).toBe(false);
  });

  it('follows his stroke with his eyes while he colors', () => {
    expect(svg('color', 0, { sx: -1 })).not.toBe(svg('color', 0, { sx: 1 }));
  });

  it('holds still with reduced motion', () => {
    const calm = { calm: true };
    expect(svg('claim', 0.5, calm)).toBe(svg('claim', 1.3, calm));
    expect(svg('tap', 0.2, calm)).toBe(svg('tap', 0.9, calm));
    expect(svg('claim', 0.5)).not.toBe(svg('claim', 1.3));
  });
});
