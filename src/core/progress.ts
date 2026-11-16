import { expandBBox, metresPerDegree, type BBox } from '../geo/geo';
import { kindFromHighway } from '../geo/pieces';
import { GridIndex } from '../geo/spatialIndex';
import type { Block } from './blocks';
import type { Building, LitHouse, LitPiece, Piece } from './types';

export interface LightResult {
  /** Pieces lit for the very first time. */
  newPieces: LitPiece[];
  /** Street names that got their first lit piece ever. */
  newStreets: string[];
  /** Houses that switched on for the first time. */
  newHouses: LitHouse[];
  /** Every piece record that changed (new or visit count bumped); these need saving. */
  changed: LitPiece[];
}

export interface Coverage {
  /** Share of the line that runs along lit pieces, 0..1. */
  fraction: number;
  /** When the oldest of those pieces was lit (Infinity when none). */
  litAt: number;
}

/**
 * Everything the user has lit, in memory. Lit pieces carry their own geometry, so they draw
 * even where the street data is not loaded.
 */
export class Progress {
  readonly lit = new GridIndex<LitPiece>();
  readonly houses = new GridIndex<LitHouse>();
  /** Street name → number of lit pieces. */
  private streetPieces = new Map<string, number>();
  private _litLenM = 0;
  private _pathPieces = 0;
  private _housesLit = 0;
  /** Bumped on every change; lets renderers cache. */
  version = 0;

  load(records: Iterable<LitPiece>): void {
    for (const r of records) this.add(r);
    this.version++;
  }

  loadHouses(records: Iterable<LitHouse>): void {
    for (const r of records) {
      if (this.houses.insert(r)) this._housesLit++;
    }
    this.version++;
  }

  private add(r: LitPiece): void {
    // Records saved before street kinds existed get a sensible one from their highway class.
    const rec: LitPiece = r.kind ? r : { ...r, kind: kindFromHighway(r.hw) };
    if (!this.lit.insert(rec)) return;
    this._litLenM += rec.len;
    if (rec.name) this.streetPieces.set(rec.name, (this.streetPieces.get(rec.name) ?? 0) + 1);
    else this._pathPieces++;
  }

  isLit(id: string): boolean {
    return this.lit.has(id);
  }

  hasStreet(name: string): boolean {
    return this.streetPieces.has(name);
  }

  get streetsMet(): number {
    return this.streetPieces.size;
  }

  get litLenM(): number {
    return this._litLenM;
  }

  get piecesLit(): number {
    return this.lit.size;
  }

  get pathPiecesLit(): number {
    return this._pathPieces;
  }

  get housesLit(): number {
    return this._housesLit;
  }

  streetNames(): string[] {
    return [...this.streetPieces.keys()];
  }

  /**
   * How much of a line already runs along lit pieces. Street ids change when the map data does
   * (and pieces saved by older versions came from another source), so a block loaded now is
   * recognised as lit by its geometry: sample points within `tolM` of a lit piece that runs the
   * same way.
   */
  coverage(coords: number[], bbox: BBox, tolM = 6): Coverage {
    const near = this.lit.query(expandBBox(bbox, tolM));
    if (!near.length || coords.length < 4) return { fraction: 0, litAt: Infinity };
    const m = metresPerDegree(coords[1]);
    const lon0 = coords[0], lat0 = coords[1];
    const X = (lon: number) => (lon - lon0) * m.lon;
    const Y = (lat: number) => (lat - lat0) * m.lat;
    const segs: number[][] = near.map((p) => {
      const out: number[] = [];
      for (let i = 0; i < p.coords.length; i += 2) out.push(X(p.coords[i]), Y(p.coords[i + 1]));
      return out;
    });
    let total = 0;
    for (let i = 2; i < coords.length; i += 2) {
      total += Math.hypot(X(coords[i]) - X(coords[i - 2]), Y(coords[i + 1]) - Y(coords[i - 1]));
    }
    if (total <= 0) return { fraction: 0, litAt: Infinity };
    const n = Math.max(3, Math.min(80, Math.ceil(total / 4)));
    const tol2 = tolM * tolM;
    let hits = 0;
    let litAt = Infinity;
    let seg = 2;
    let segStart = 0;
    for (let k = 0; k < n; k++) {
      const d = ((k + 0.5) / n) * total;
      // Walk to the block segment holding distance d.
      let ax = X(coords[seg - 2]), ay = Y(coords[seg - 1]), bx = X(coords[seg]), by = Y(coords[seg + 1]);
      let len = Math.hypot(bx - ax, by - ay);
      while (segStart + len < d && seg + 2 < coords.length) {
        segStart += len;
        seg += 2;
        ax = bx;
        ay = by;
        bx = X(coords[seg]);
        by = Y(coords[seg + 1]);
        len = Math.hypot(bx - ax, by - ay);
      }
      const t = len > 0 ? (d - segStart) / len : 0;
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      const dx = len > 0 ? (bx - ax) / len : 1, dy = len > 0 ? (by - ay) / len : 0;
      for (let j = 0; j < segs.length; j++) {
        const s = segs[j];
        let hit = false;
        for (let i = 2; i < s.length; i += 2) {
          const ex = s[i] - s[i - 2], ey = s[i + 1] - s[i - 1];
          const l2 = ex * ex + ey * ey;
          if (l2 <= 0) continue;
          let u = ((px - s[i - 2]) * ex + (py - s[i - 1]) * ey) / l2;
          // Past the end of a lit line by more than a metre is not along it.
          const over = u < 0 ? -u : u > 1 ? u - 1 : 0;
          if (over * over * l2 > 1) continue;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const qx = s[i - 2] + u * ex - px, qy = s[i - 1] + u * ey - py;
          if (qx * qx + qy * qy > tol2) continue;
          // Same direction (either way along it), so a cross street at a corner does not count.
          if (Math.abs(ex * dx + ey * dy) / Math.sqrt(l2) < 0.7) continue;
          hit = true;
          break;
        }
        if (hit) {
          hits++;
          if (near[j].litAt < litAt) litAt = near[j].litAt;
          break;
        }
      }
    }
    return { fraction: hits / n, litAt };
  }

  /**
   * Light the given pieces for a walk. A piece's visit count goes up at most once per walk.
   */
  apply(pieces: Iterable<Piece>, walkId: string, now: number): LightResult {
    const newPieces: LitPiece[] = [];
    const newStreets: string[] = [];
    const changed: LitPiece[] = [];
    for (const p of pieces) {
      const existing = this.lit.get(p.id);
      if (existing) {
        if (existing.lastWalk !== walkId) {
          existing.visits += 1;
          existing.lastWalk = walkId;
          changed.push(existing);
        }
        continue;
      }
      const rec: LitPiece = {
        id: p.id, way: p.way, idx: p.idx, name: p.name, hw: p.hw, kind: p.kind, len: p.len,
        coords: p.coords, bbox: p.bbox, litAt: now, visits: 1, lastWalk: walkId,
      };
      if (rec.name && !this.streetPieces.has(rec.name)) newStreets.push(rec.name);
      this.add(rec);
      newPieces.push(rec);
      changed.push(rec);
    }
    if (changed.length) this.version++;
    return { newPieces, newStreets, newHouses: [], changed };
  }

  /** Light a block that just unlocked, and every house beside it, once. */
  applyBlock(block: Block, houses: Iterable<Building>, walkId: string, now: number): LightResult {
    const res = this.apply(block.pieces, walkId, now);
    res.newHouses = this.applyHouses(houses, block.id, now);
    return res;
  }

  applyHouses(houses: Iterable<Building>, block: string, now: number): LitHouse[] {
    const lit: LitHouse[] = [];
    for (const h of houses) {
      if (this.houses.has(h.id) || this.hasHouseAt(h)) continue;
      const rec: LitHouse = { id: h.id, coords: h.coords, bbox: h.bbox, litAt: now, block };
      if (h.holes) rec.holes = h.holes;
      if (this.houses.insert(rec)) {
        this._housesLit++;
        lit.push(rec);
      }
    }
    if (lit.length) this.version++;
    return lit;
  }

  /** Is the same footprint already lit under another id (older map data)? Compares bboxes. */
  private hasHouseAt(h: Building): boolean {
    const tol = 1.5e-5; // about 1-1.5 m
    for (const o of this.houses.query(h.bbox)) {
      if (
        Math.abs(o.bbox[0] - h.bbox[0]) < tol && Math.abs(o.bbox[1] - h.bbox[1]) < tol &&
        Math.abs(o.bbox[2] - h.bbox[2]) < tol && Math.abs(o.bbox[3] - h.bbox[3]) < tol
      ) return true;
    }
    return false;
  }
}

/** Strip runtime-only fields before saving a lit piece. */
export function toStoredLit(p: LitPiece): LitPiece {
  const { merc: _merc, ...rest } = p;
  return rest;
}

/** Strip runtime-only fields before saving a lit house. */
export function toStoredHouse(h: LitHouse): LitHouse {
  const { merc: _merc, ...rest } = h;
  return rest;
}
