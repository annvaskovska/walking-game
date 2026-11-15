import { CONFIG } from '../config';
import { bboxOfCoords } from '../geo/geo';
import { GridIndex } from '../geo/spatialIndex';
import type { BBox } from '../geo/geo';
import type { Piece, PieceKind, WayInput } from './types';

/**
 * A city block: one continuous stretch of a single OSM way between two junctions (or a way end).
 * Walk along about half of it and the whole block unlocks, with its houses and street name.
 */
export interface Block {
  /** Stable for the way's geometry: `wayId:firstPiece-lastPiece`. */
  id: string;
  way: number;
  name: string | null;
  hw: string;
  kind: PieceKind;
  /** The pieces of the way this block covers, in order. */
  pieces: Piece[];
  /** The block's line, pieces joined end to end. */
  coords: number[];
  lenM: number;
  bbox: BBox;
}

type BlockCfg = Pick<typeof CONFIG, 'maxBlockLengthM'>;

/** Cut index (between pieces) nearest to a distance along the way. */
function boundaryAt(pieces: Piece[], metres: number): number {
  let acc = 0;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i <= pieces.length; i++) {
    const diff = Math.abs(acc - metres);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
    if (i < pieces.length) acc += pieces[i].len;
  }
  return best;
}

/** Split a run of pieces into chunks no longer than `maxLenM`, at piece boundaries. */
function capLength(run: Piece[], maxLenM: number): Piece[][] {
  let total = 0;
  for (const p of run) total += p.len;
  if (total <= maxLenM) return [run];
  const chunks = Math.ceil(total / maxLenM);
  const target = total / chunks;
  const out: Piece[][] = [];
  let start = 0;
  let acc = 0;
  for (let i = 0; i < run.length; i++) {
    acc += run[i].len;
    if (acc >= target * (out.length + 1) - 1e-6 || i === run.length - 1) {
      out.push(run.slice(start, i + 1));
      start = i + 1;
    }
  }
  return out;
}

function makeBlock(way: WayInput, pieces: Piece[]): Block {
  const coords: number[] = [];
  for (const p of pieces) {
    if (coords.length && p.coords[0] === coords[coords.length - 2] && p.coords[1] === coords[coords.length - 1]) {
      coords.push(...p.coords.slice(2));
    } else {
      coords.push(...p.coords);
    }
  }
  return {
    id: `${way.id}:${pieces[0].idx}-${pieces[pieces.length - 1].idx}`,
    way: way.id,
    name: way.name,
    hw: way.highway,
    kind: way.kind,
    pieces,
    coords,
    lenM: pieces.reduce((s, p) => s + p.len, 0),
    bbox: bboxOfCoords(coords),
  };
}

/** Group a way's pieces into blocks, cutting at junctions and then at the maximum length. */
export function buildBlocks(way: WayInput, pieces: Piece[], cfg: BlockCfg = CONFIG): Block[] {
  const order = [...pieces].sort((a, b) => a.idx - b.idx);
  if (!order.length) return [];
  let total = 0;
  for (const p of order) total += p.len;

  const cuts = new Set<number>([0, order.length]);
  for (const d of way.junctionsM ?? []) {
    if (d > 0.5 && d < total - 0.5) cuts.add(boundaryAt(order, d));
  }
  const sorted = [...cuts].sort((a, b) => a - b);

  const blocks: Block[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const run = order.slice(sorted[i - 1], sorted[i]);
    if (!run.length) continue;
    for (const chunk of capLength(run, cfg.maxBlockLengthM)) blocks.push(makeBlock(way, chunk));
  }
  return blocks;
}

/**
 * All blocks loaded so far, indexed by piece and by bbox. A way is only added once; its blocks
 * replace nothing because a way's pieces are fetched together.
 */
export class Blocks {
  readonly index = new GridIndex<Block>();
  private byWay = new Map<number, Block[]>();
  private byPiece = new Map<string, Block>();

  add(way: WayInput, pieces: Piece[], cfg: BlockCfg = CONFIG): Block[] {
    if (this.byWay.has(way.id)) return [];
    const blocks = buildBlocks(way, pieces, cfg);
    if (!blocks.length) return [];
    this.byWay.set(way.id, blocks);
    for (const b of blocks) {
      this.index.insert(b);
      for (const p of b.pieces) this.byPiece.set(p.id, b);
    }
    return blocks;
  }

  get(id: string): Block | undefined {
    return this.index.get(id);
  }

  get size(): number {
    return this.index.size;
  }

  values(): IterableIterator<Block> {
    return this.index.values();
  }

  /** The block a piece belongs to, or undefined for a sidewalk/path that is not in any block. */
  blockOf(pieceId: string): Block | undefined {
    return this.byPiece.get(pieceId);
  }
}
