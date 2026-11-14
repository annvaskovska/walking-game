import type { BBox } from './geo';

export interface Indexable {
  id: string;
  bbox: BBox;
}

const OFFSET = 1 << 19;
const SPAN = 1 << 20;

/**
 * Uniform grid over lon/lat. Each item is registered in every cell its bbox touches.
 * Queries visit only the cells under the query box, so cost scales with what's in view,
 * not with the total number of pieces.
 */
export class GridIndex<T extends Indexable> {
  private cells = new Map<number, T[]>();
  private items = new Map<string, T>();

  constructor(readonly cellDeg = 0.001, readonly maxCellsPerQuery = 40_000) {}

  get size(): number {
    return this.items.size;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  values(): IterableIterator<T> {
    return this.items.values();
  }

  private key(cx: number, cy: number): number {
    return (cx + OFFSET) * SPAN + (cy + OFFSET);
  }

  private range(b: BBox): [number, number, number, number] {
    const d = this.cellDeg;
    return [Math.floor(b[0] / d), Math.floor(b[1] / d), Math.floor(b[2] / d), Math.floor(b[3] / d)];
  }

  /** Adds an item; returns false (and keeps the old one) when the id is already present. */
  insert(item: T): boolean {
    if (this.items.has(item.id)) return false;
    this.items.set(item.id, item);
    const [x0, y0, x1, y1] = this.range(item.bbox);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
    }
    return true;
  }

  /** Replaces the stored object for an id (same bbox assumed), or inserts it. */
  upsert(item: T): void {
    const old = this.items.get(item.id);
    if (!old) {
      this.insert(item);
      return;
    }
    if (old === item) return;
    this.remove(item.id);
    this.insert(item);
  }

  remove(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.delete(id);
    const [x0, y0, x1, y1] = this.range(item.bbox);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        const list = this.cells.get(k);
        if (!list) continue;
        const i = list.indexOf(item);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this.cells.delete(k);
      }
    }
    return true;
  }

  /** Items whose bbox intersects the query box. Each item is returned once. */
  query(b: BBox): T[] {
    const out: T[] = [];
    const [x0, y0, x1, y1] = this.range(b);
    const nCells = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (nCells > this.maxCellsPerQuery || nCells > this.items.size) {
      for (const it of this.items.values()) if (intersects(it.bbox, b)) out.push(it);
      return out;
    }
    const seen = new Set<string>();
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = this.cells.get(this.key(x, y));
        if (!list) continue;
        for (const it of list) {
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          if (intersects(it.bbox, b)) out.push(it);
        }
      }
    }
    return out;
  }
}

function intersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
