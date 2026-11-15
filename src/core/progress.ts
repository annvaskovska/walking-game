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

/**
 * Everything the user has lit, in memory. Lit pieces carry their own geometry, so they draw
 * even where the street cells are not loaded.
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

  /** Has every piece of this block been lit? Used to recognise whole blocks from old walks. */
  isBlockLit(block: Block): boolean {
    return block.pieces.every((p) => this.isLit(p.id));
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

  /** Light every house near a block that just unlocked, once. */
  applyBlock(block: Block, houses: Iterable<Building>, walkId: string, now: number): LightResult {
    const res = this.apply(block.pieces, walkId, now);
    res.newHouses = this.applyHouses(houses, block.way, now);
    return res;
  }

  applyHouses(houses: Iterable<Building>, block: number, now: number): LitHouse[] {
    const lit: LitHouse[] = [];
    for (const h of houses) {
      if (this.houses.has(h.id)) continue;
      const rec: LitHouse = { id: h.id, coords: h.coords, bbox: h.bbox, litAt: now, block };
      if (this.houses.insert(rec)) {
        this._housesLit++;
        lit.push(rec);
      }
    }
    if (lit.length) this.version++;
    return lit;
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
