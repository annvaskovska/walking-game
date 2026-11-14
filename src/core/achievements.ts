import { isRealWalk, streaks } from './stats';
import type { WalkRecord } from './types';

export interface StampContext {
  streetsMet: number;
  piecesLit: number;
  litLenM: number;
  walks: WalkRecord[];
  now: number;
}

export interface StampDef {
  id: string;
  title: string;
  desc: string;
  icon: string;
  /** Progress towards the stamp as [current, target], for the locked state. */
  progress?: (c: StampContext) => [number, number];
  earned: (c: StampContext) => boolean;
}

const hourOf = (ts: number) => new Date(ts).getHours();
export const isNightWalk = (w: WalkRecord) => hourOf(w.startedAt) >= 20 || hourOf(w.startedAt) < 4;
export const isEarlyWalk = (w: WalkRecord) => hourOf(w.startedAt) >= 4 && hourOf(w.startedAt) < 8;

const streetCount = (target: number): Pick<StampDef, 'progress' | 'earned'> => ({
  progress: (c) => [Math.min(c.streetsMet, target), target],
  earned: (c) => c.streetsMet >= target,
});

const streakOf = (target: number): Pick<StampDef, 'progress' | 'earned'> => ({
  progress: (c) => [Math.min(streaks(c.walks, c.now).best, target), target],
  earned: (c) => streaks(c.walks, c.now).best >= target,
});

export const STAMPS: StampDef[] = [
  {
    id: 'first-light', title: 'First Light', icon: '✨',
    desc: 'Light up your very first street.',
    progress: (c) => [Math.min(c.piecesLit, 1), 1],
    earned: (c) => c.piecesLit > 0,
  },
  { id: 'streets-10', title: 'Wanderer', icon: '🧭', desc: 'Meet 10 different streets.', ...streetCount(10) },
  { id: 'streets-50', title: 'Pathfinder', icon: '🗺️', desc: 'Meet 50 different streets.', ...streetCount(50) },
  { id: 'streets-100', title: 'City Whisperer', icon: '🏙️', desc: 'Meet 100 different streets.', ...streetCount(100) },
  {
    id: 'new-5km', title: 'Five Bright Kilometres', icon: '👣',
    desc: 'Light 5 km of streets in total.',
    progress: (c) => [Math.min(Math.floor(c.litLenM / 100) / 10, 5), 5],
    earned: (c) => c.litLenM >= 5000,
  },
  {
    id: 'night-owl', title: 'Night Owl', icon: '🦉', desc: 'Go for a walk after 20:00.',
    earned: (c) => c.walks.some((w) => isRealWalk(w) && isNightWalk(w)),
  },
  {
    id: 'early-bird', title: 'Early Bird', icon: '🐦', desc: 'Go for a walk before 08:00.',
    earned: (c) => c.walks.some((w) => isRealWalk(w) && isEarlyWalk(w)),
  },
  { id: 'streak-3', title: 'Three in a Row', icon: '🔥', desc: 'Walk on 3 days in a row.', ...streakOf(3) },
  { id: 'streak-7', title: 'Week of Light', icon: '🌟', desc: 'Walk on 7 days in a row.', ...streakOf(7) },
  {
    id: 'park', title: 'Green Detour', icon: '🌳', desc: 'Walk through a park.',
    earned: (c) => c.walks.some((w) => w.visitedPark),
  },
];

/** Stamps earned in this context that aren't in `already`, in definition order. */
export function newlyEarned(ctx: StampContext, already: Set<string>): StampDef[] {
  return STAMPS.filter((s) => !already.has(s.id) && s.earned(ctx));
}

export function stampById(id: string): StampDef | undefined {
  return STAMPS.find((s) => s.id === id);
}
