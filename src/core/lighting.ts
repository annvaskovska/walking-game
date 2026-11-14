import { expandBBox, segmentToPolylineM, type BBox } from '../geo/geo';
import type { GridIndex } from '../geo/spatialIndex';
import type { Piece } from './types';

/** Every piece whose geometry comes within `radiusM` of the walked segment a→b. */
export function piecesNearSegment<T extends Piece>(
  index: GridIndex<T>,
  aLon: number, aLat: number, bLon: number, bLat: number,
  radiusM: number,
): T[] {
  const box: BBox = expandBBox(
    [Math.min(aLon, bLon), Math.min(aLat, bLat), Math.max(aLon, bLon), Math.max(aLat, bLat)],
    radiusM,
  );
  const hits: T[] = [];
  for (const p of index.query(box)) {
    if (segmentToPolylineM(aLon, aLat, bLon, bLat, p.coords) <= radiusM) hits.push(p);
  }
  return hits;
}

/** Flat track of walked segments: [aLon, aLat, bLon, bLat, radius, ...]. */
export const SEG_STRIDE = 5;

/** Run a recorded track against an index (used when streets arrive after the walking happened). */
export function piecesNearTrack<T extends Piece>(index: GridIndex<T>, segs: ArrayLike<number>): T[] {
  const found = new Map<string, T>();
  for (let i = 0; i + SEG_STRIDE <= segs.length; i += SEG_STRIDE) {
    for (const p of piecesNearSegment(index, segs[i], segs[i + 1], segs[i + 2], segs[i + 3], segs[i + 4])) {
      found.set(p.id, p);
    }
  }
  return [...found.values()];
}
