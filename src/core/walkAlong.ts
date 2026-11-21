import { CONFIG } from '../config';
import { clamp, distanceM, expandBBox, projectOnPolylineM } from '../geo/geo';
import type { Block, Blocks } from './blocks';
import type { Piece } from './types';

/** Flat track of walked segments, as saved with an active walk: [aLon, aLat, bLon, bLat, radius, ...]. */
export const SEG_STRIDE = 5;

type WalkCfg = Pick<
  typeof CONFIG,
  | 'walkAlongRadiusM' | 'walkAlongFactor' | 'walkAlongMinM' | 'parallelTieM'
  | 'sideNearRoadM' | 'blockUnlockFraction' | 'blockMinCoverM' | 'pieceLightFraction' | 'pieceMinCoverM'
>;

interface Candidate {
  block: Block;
  /** Worst lateral distance of the step's two ends (metres). */
  distM: number;
  /** The stretch of the block the step advanced along, in metres from the block's start. */
  fromM: number;
  toM: number;
}

/** What a walked step lit. */
export interface Walked {
  /** Blocks it completed: all their pieces light, with their houses and name. */
  blocks: Block[];
  /** Pieces it lit on their own, in blocks that are not complete yet. */
  pieces: Piece[];
}

/**
 * The "walked along it" rule. Each good GPS step is matched to the street it follows — close,
 * parallel, and advancing along it — rather than to everything within a radius.
 *
 * What you walk lights as you walk it: the walked length is kept per block, measured along the
 * whole block so no step is lost where two pieces meet, and every ~20 m piece lights once a good
 * part of it is walked. At about half a block's length the rest of the block lights too.
 *
 * A walk replayed after a reload, or after streets arrive late, lights the same streets:
 * `add` only depends on the segments and the loaded blocks, never on call order.
 */
export class WalkAlong {
  /** Per block: walked intervals along it, sorted and merged, in metres from its start. */
  private coverage = new Map<string, [number, number][]>();
  private unlocked = new Set<string>();
  /** Pieces already reported on their own. */
  private litPieces = new Set<string>();

  constructor(
    private blocks: Blocks,
    private isUnlocked: (block: Block) => boolean = () => false,
    private cfg: WalkCfg = CONFIG,
  ) {}

  /**
   * Add one walked step a→b and return what it lit, each block and piece once.
   * `radiusM` is the GPS-derived search radius; the rule never matches farther than
   * `walkAlongRadiusM`.
   */
  add(aLon: number, aLat: number, bLon: number, bLat: number, radiusM: number): Walked {
    const out: Walked = { blocks: [], pieces: [] };
    const stepM = distanceM(aLon, aLat, bLon, bLat);
    if (stepM < 0.05) return out;
    const radius = Math.min(radiusM, this.cfg.walkAlongRadiusM);
    const box = expandBBox(
      [Math.min(aLon, bLon), Math.min(aLat, bLat), Math.max(aLon, bLon), Math.max(aLat, bLat)],
      radius,
    );
    const minAlongM = Math.max(this.cfg.walkAlongMinM, this.cfg.walkAlongFactor * stepM);
    // Where a block doubles back on itself, the two ends of a step can land on different arms.
    const maxAlongM = stepM * 1.5 + 2;

    const passing: Candidate[] = [];
    for (const block of this.blocks.index.query(box)) {
      if (block.kind === 'side') continue;
      const from = projectOnPolylineM(aLon, aLat, block.coords);
      const to = projectOnPolylineM(bLon, bLat, block.coords);
      if (from.distM > radius || to.distM > radius) continue;
      const alongM = Math.abs(to.alongM - from.alongM);
      if (alongM < minAlongM || alongM > maxAlongM) continue;
      passing.push({
        block,
        distM: Math.max(from.distM, to.distM),
        fromM: Math.min(from.alongM, to.alongM),
        toM: Math.max(from.alongM, to.alongM),
      });
    }
    if (!passing.length) return out;

    // Only the street you are actually on: a parallel street a few metres farther was not walked.
    let nearest = Infinity;
    for (const c of passing) if (c.distM < nearest) nearest = c.distM;
    const kept = passing.filter((c) => c.distM <= nearest + this.cfg.parallelTieM);

    // A footway running right beside a road you are also following is that road's sidewalk,
    // even when OSM did not tag it as one. Named paths and cycleways stay in their own right.
    const roads = kept.filter((c) => c.block.kind === 'road');
    const walked = kept.filter((c) => {
      const b = c.block;
      if (b.kind !== 'path' || b.name) return true;
      if (b.hw !== 'footway' && b.hw !== 'path' && b.hw !== 'steps') return true;
      return !roads.some((r) => Math.abs(r.distM - c.distM) <= this.cfg.sideNearRoadM);
    });

    for (const c of walked) {
      const block = c.block;
      if (this.unlocked.has(block.id) || this.isUnlocked(block)) {
        this.unlocked.add(block.id);
        continue;
      }
      const intervals = this.addCoverage(block, c.fromM, c.toM);
      let coveredM = 0;
      const fresh: Piece[] = [];
      let startM = 0;
      for (const p of block.pieces) {
        const walkedM = overlapM(intervals, startM, startM + p.len);
        coveredM += walkedM;
        if (walkedM >= this.pieceNeededM(p) && !this.litPieces.has(p.id)) fresh.push(p);
        startM += p.len;
      }
      if (coveredM >= this.neededM(block)) {
        this.unlocked.add(block.id);
        out.blocks.push(block);
        continue;
      }
      for (const p of fresh) {
        this.litPieces.add(p.id);
        out.pieces.push(p);
      }
    }
    return out;
  }

  /** Replay saved segments (reload mid-walk, or streets that arrived late). */
  replay(segs: ArrayLike<number>): Walked {
    const blocks = new Map<string, Block>();
    const pieces = new Map<string, Piece>();
    for (let i = 0; i + SEG_STRIDE <= segs.length; i += SEG_STRIDE) {
      const w = this.add(segs[i], segs[i + 1], segs[i + 2], segs[i + 3], segs[i + 4]);
      for (const b of w.blocks) blocks.set(b.id, b);
      for (const p of w.pieces) pieces.set(p.id, p);
    }
    // A piece of a block that completed later comes with the block.
    for (const b of blocks.values()) for (const p of b.pieces) pieces.delete(p.id);
    return { blocks: [...blocks.values()], pieces: [...pieces.values()] };
  }

  private neededM(block: Block): number {
    return Math.max(
      block.lenM * this.cfg.blockUnlockFraction,
      Math.min(block.lenM, this.cfg.blockMinCoverM),
    );
  }

  private pieceNeededM(piece: Piece): number {
    return Math.max(
      piece.len * this.cfg.pieceLightFraction,
      Math.min(piece.len, this.cfg.pieceMinCoverM),
    );
  }

  /** Add a walked interval to a block, keeping the union so backtracking never double-counts. */
  private addCoverage(block: Block, a: number, b: number): [number, number][] {
    const lo = clamp(Math.min(a, b), 0, block.lenM);
    const hi = clamp(Math.max(a, b), 0, block.lenM);
    let intervals = this.coverage.get(block.id);
    if (!intervals) {
      intervals = [];
      this.coverage.set(block.id, intervals);
    }
    if (hi - lo < 0.05) return intervals;
    let i = 0;
    while (i < intervals.length && intervals[i][0] < lo) i++;
    intervals.splice(i, 0, [lo, hi]);
    const merged: [number, number][] = [];
    for (const it of intervals) {
      const last = merged[merged.length - 1];
      if (last && it[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], it[1]);
      else merged.push([it[0], it[1]]);
    }
    this.coverage.set(block.id, merged);
    return merged;
  }
}

/** Length of [lo, hi] covered by sorted, merged intervals. */
function overlapM(intervals: [number, number][], lo: number, hi: number): number {
  let sum = 0;
  for (const [a, b] of intervals) {
    if (b <= lo) continue;
    if (a >= hi) break;
    sum += Math.min(b, hi) - Math.max(a, lo);
  }
  return sum;
}
