import { CONFIG } from '../config';
import { bboxOfCoords } from '../geo/geo';
import { GridIndex } from '../geo/spatialIndex';
import type { BBox } from '../geo/geo';
import type { Piece, PieceKind, WayInput } from './types';

/**
 * A city block: one stretch of street between two junctions (or a junction and a dead end).
 * Walk along about half of it and the whole block unlocks, with its houses and street name.
 * Long stretches are cut every `maxBlockLengthM`, so they unlock in stages.
 */
export interface Block {
  /** Stable for the way's geometry: `wayId:firstPiece-lastPiece`. */
  id: string;
  way: string;
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

/** Group a way's pieces into blocks no longer than the maximum block length. */
export function buildBlocks(way: WayInput, pieces: Piece[], cfg: BlockCfg = CONFIG): Block[] {
  const order = [...pieces].sort((a, b) => a.idx - b.idx);
  if (!order.length) return [];
  return capLength(order, cfg.maxBlockLengthM).map((chunk) => makeBlock(way, chunk));
}

/** All blocks loaded so far, indexed by bbox and by piece. */
export class Blocks {
  readonly index = new GridIndex<Block>();
  private byPiece = new Map<string, Block>();

  /** Build a way's blocks and add the ones not loaded yet; returns those. */
  add(way: WayInput, pieces: Piece[], cfg: BlockCfg = CONFIG): Block[] {
    return buildBlocks(way, pieces, cfg).filter((b) => this.addBlock(b));
  }

  /** Add one block built elsewhere (the tile worker). False when it is already loaded. */
  addBlock(b: Block): boolean {
    if (!this.index.insert(b)) return false;
    for (const p of b.pieces) this.byPiece.set(p.id, b);
    return true;
  }

  remove(id: string): Block | undefined {
    const b = this.index.get(id);
    if (!b) return undefined;
    this.index.remove(id);
    for (const p of b.pieces) if (this.byPiece.get(p.id) === b) this.byPiece.delete(p.id);
    return b;
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

  /** The block a piece belongs to, or undefined for a piece that is not loaded. */
  blockOf(pieceId: string): Block | undefined {
    return this.byPiece.get(pieceId);
  }
}
