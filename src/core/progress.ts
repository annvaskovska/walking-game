import { GridIndex } from '../geo/spatialIndex';
import type { LitPiece, Piece } from './types';

export interface LightResult {
  /** Pieces lit for the very first time. */
  newPieces: LitPiece[];
  /** Street names that got their first lit piece ever. */
  newStreets: string[];
  /** Every record that changed (new or visit count bumped); these need saving. */
  changed: LitPiece[];
}

/**
 * Everything the user has lit, in memory. Lit pieces carry their own geometry, so they draw
 * even where the street cells are not loaded.
 */
export class Progress {
  readonly lit = new GridIndex<LitPiece>();
  /** Street name → number of lit pieces. */
  private streetPieces = new Map<string, number>();
  private _litLenM = 0;
  private _pathPieces = 0;
  /** Bumped on every change; lets renderers cache. */
  version = 0;

  load(records: Iterable<LitPiece>): void {
    for (const r of records) this.add(r);
    this.version++;
  }

  private add(r: LitPiece): void {
    if (!this.lit.insert(r)) return;
    this._litLenM += r.len;
    if (r.name) this.streetPieces.set(r.name, (this.streetPieces.get(r.name) ?? 0) + 1);
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

  streetNames(): string[] {
    return [...this.streetPieces.keys()];
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
        id: p.id, way: p.way, idx: p.idx, name: p.name, hw: p.hw, len: p.len,
        coords: p.coords, bbox: p.bbox, litAt: now, visits: 1, lastWalk: walkId,
      };
      if (rec.name && !this.streetPieces.has(rec.name)) newStreets.push(rec.name);
      this.add(rec);
      newPieces.push(rec);
      changed.push(rec);
    }
    if (changed.length) this.version++;
    return { newPieces, newStreets, changed };
  }
}

/** Strip runtime-only fields before saving a lit piece. */
export function toStoredLit(p: LitPiece): LitPiece {
  const { merc: _merc, ...rest } = p;
  return rest;
}
