/**
 * Off the main thread: decode one z14 basemap tile and build its street blocks, houses and
 * landmarks, so the walker on the map never stutters while a new part of town loads.
 */
import { buildBlocks, type Block } from '../core/blocks';
import type { Building, Place } from '../core/types';
import { splitWay } from '../geo/pieces';
import { decodeTile } from './mvt';
import { parseTile, TILE_LAYERS } from './tileParse';

export interface TileJob {
  id: number;
  z: number;
  x: number;
  y: number;
  buf: ArrayBuffer;
}

export type TileResult =
  | { id: number; ok: true; blocks: Block[]; houses: Building[]; places: Place[]; ms: number }
  | { id: number; ok: false; error: string };

/** The worker scope, typed without pulling the WebWorker lib into a DOM project. */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<TileJob>) => void) | null;
  postMessage(msg: TileResult): void;
};

scope.onmessage = (e) => {
  const { id, z, x, y, buf } = e.data;
  const t0 = performance.now();
  try {
    const { ways, houses, places } = parseTile(decodeTile(buf, TILE_LAYERS), z, x, y);
    const blocks: Block[] = [];
    for (const w of ways) {
      const pieces = splitWay(w);
      if (pieces.length) for (const b of buildBlocks(w, pieces)) blocks.push(b);
    }
    const res: TileResult = { id, ok: true, blocks, houses, places, ms: Math.round(performance.now() - t0) };
    scope.postMessage(res);
  } catch (err) {
    const res: TileResult = { id, ok: false, error: String((err as Error)?.message ?? err) };
    scope.postMessage(res);
  }
};
