import { CONFIG } from '../config';
import { clamp, distanceM, expandBBox, projectOnPolylineM } from '../geo/geo';
import type { GridIndex } from '../geo/spatialIndex';
import type { Block, Blocks } from './blocks';
import type { Piece } from './types';

/** Flat track of walked segments, as saved with an active walk: [aLon, aLat, bLon, bLat, radius, ...]. */
export const SEG_STRIDE = 5;

type WalkCfg = Pick<
  typeof CONFIG,
  | 'walkAlongRadiusM' | 'walkAlongFactor' | 'walkAlongMinM' | 'parallelTieM'
  | 'sideNearRoadM' | 'blockUnlockFraction' | 'blockMinCoverM'
>;

interface Candidate {
  piece: Piece;
  /** Worst lateral distance of the step's two ends (metres). */
  distM: number;
  fromM: number;
  toM: number;
}

interface PieceCoverage {
  /** Covered intervals along the piece, sorted and merged, in metres from its start. */
  intervals: [number, number][];
  lenM: number;
}

/**
 * The "walked along it" rule. Each good GPS step is matched to the street it follows — close,
 * parallel, and advancing along it — rather than to everything within a radius. The covered
 * length of each block accumulates; at about half its length the whole block unlocks.
 *
 * A walk replayed after a reload, or after streets arrive late, produces the same blocks:
 * `add` only depends on the segments and the loaded pieces, never on call order.
 */
export class WalkAlong {
  private coverage = new Map<string, PieceCoverage>();
  private unlocked = new Set<string>();

  constructor(
    private blocks: Blocks,
    private pieces: GridIndex<Piece>,
    private isUnlocked: (block: Block) => boolean = () => false,
    private cfg: WalkCfg = CONFIG,
  ) {}

  /**
   * Add one walked step a→b. Returns the blocks it completed, each once, with all their pieces.
   * `radiusM` is the GPS-derived search radius; the rule never matches farther than
   * `walkAlongRadiusM`.
   */
  add(aLon: number, aLat: number, bLon: number, bLat: number, radiusM: number): Block[] {
    const stepM = distanceM(aLon, aLat, bLon, bLat);
    if (stepM < 0.05) return [];
    const radius = Math.min(radiusM, this.cfg.walkAlongRadiusM);
    const box = expandBBox(
      [Math.min(aLon, bLon), Math.min(aLat, bLat), Math.max(aLon, bLon), Math.max(aLat, bLat)],
      radius,
    );
    const minAlongM = Math.max(this.cfg.walkAlongMinM, this.cfg.walkAlongFactor * stepM);

    const passing: Candidate[] = [];
    for (const piece of this.pieces.query(box)) {
      if (piece.kind === 'side') continue;
      const from = projectOnPolylineM(aLon, aLat, piece.coords);
      const to = projectOnPolylineM(bLon, bLat, piece.coords);
      if (from.distM > radius || to.distM > radius) continue;
      if (Math.abs(to.alongM - from.alongM) < minAlongM) continue;
      passing.push({
        piece,
        distM: Math.max(from.distM, to.distM),
        fromM: Math.min(from.alongM, to.alongM),
        toM: Math.max(from.alongM, to.alongM),
      });
    }
    if (!passing.length) return [];

    // Only the street you are actually on: a parallel street a few metres farther was not walked.
    let nearest = Infinity;
    for (const c of passing) if (c.distM < nearest) nearest = c.distM;
    const kept = passing.filter((c) => c.distM <= nearest + this.cfg.parallelTieM);

    // A footway running right beside a road you are also following is that road's sidewalk,
    // even when OSM did not tag it as one. Named paths and cycleways stay in their own right.
    const roads = kept.filter((c) => c.piece.kind === 'road');
    const walked = kept.filter((c) => {
      if (c.piece.kind !== 'path' || c.piece.name) return true;
      if (c.piece.hw !== 'footway' && c.piece.hw !== 'path' && c.piece.hw !== 'steps') return true;
      return !roads.some((r) => Math.abs(r.distM - c.distM) <= this.cfg.sideNearRoadM);
    });

    const out: Block[] = [];
    for (const c of walked) {
      const block = this.blocks.blockOf(c.piece.id);
      if (!block) continue;
      if (this.unlocked.has(block.id) || this.isUnlocked(block)) {
        this.unlocked.add(block.id);
        continue;
      }
      this.addCoverage(c.piece, c.fromM, c.toM);
      if (this.coveredM(block) >= this.neededM(block)) {
        this.unlocked.add(block.id);
        out.push(block);
      }
    }
    return out;
  }

  /** Replay saved segments (reload mid-walk, or streets that arrived late). */
  replay(segs: ArrayLike<number>): Block[] {
    const out = new Map<string, Block>();
    for (let i = 0; i + SEG_STRIDE <= segs.length; i += SEG_STRIDE) {
      for (const b of this.add(segs[i], segs[i + 1], segs[i + 2], segs[i + 3], segs[i + 4])) {
        out.set(b.id, b);
      }
    }
    return [...out.values()];
  }

  private neededM(block: Block): number {
    return Math.max(
      block.lenM * this.cfg.blockUnlockFraction,
      Math.min(block.lenM, this.cfg.blockMinCoverM),
    );
  }

  private coveredM(block: Block): number {
    let sum = 0;
    for (const p of block.pieces) sum += this.coverage.get(p.id)?.lenM ?? 0;
    return sum;
  }

  /** Add a walked interval to a piece, keeping the union so backtracking never double-counts. */
  private addCoverage(piece: Piece, a: number, b: number): void {
    const lo = clamp(Math.min(a, b), 0, piece.len);
    const hi = clamp(Math.max(a, b), 0, piece.len);
    if (hi - lo < 0.05) return;
    let cov = this.coverage.get(piece.id);
    if (!cov) {
      cov = { intervals: [[lo, hi]], lenM: hi - lo };
      this.coverage.set(piece.id, cov);
      return;
    }
    let i = 0;
    while (i < cov.intervals.length && cov.intervals[i][0] < lo) i++;
    cov.intervals.splice(i, 0, [lo, hi]);
    const merged: [number, number][] = [];
    for (const it of cov.intervals) {
      const last = merged[merged.length - 1];
      if (last && it[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], it[1]);
      else merged.push([it[0], it[1]]);
    }
    cov.intervals = merged;
    cov.lenM = merged.reduce((s, it) => s + it[1] - it[0], 0);
  }
}
