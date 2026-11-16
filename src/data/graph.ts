import { Blocks, type Block } from '../core/blocks';
import type { Building, Piece } from '../core/types';
import { expandBBox, polylineDistanceM, type BBox } from '../geo/geo';
import { GridIndex } from '../geo/spatialIndex';

/**
 * The walkable streets and the houses of the map tiles loaded around you, indexed for the
 * walking rule. Tiles come and go as you move; what you lit lives on in `Progress`.
 */
export class StreetGraph {
  readonly pieces = new GridIndex<Piece>();
  readonly blocks = new Blocks();
  readonly houses = new GridIndex<Building>();
  private tiles = new Map<string, { blocks: Block[]; houses: Building[] }>();
  /** Bumped on every change. */
  version = 0;

  has(key: string): boolean {
    return this.tiles.has(key);
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  /** Add a parsed tile; returns its blocks. */
  addTile(key: string, blocks: Block[], houses: Building[]): Block[] {
    if (this.tiles.has(key)) return [];
    const added: Block[] = [];
    for (const b of blocks) {
      if (!this.blocks.addBlock(b)) continue;
      for (const p of b.pieces) this.pieces.insert(p);
      added.push(b);
    }
    const hs: Building[] = [];
    for (const h of houses) if (this.houses.insert(h)) hs.push(h);
    this.tiles.set(key, { blocks: added, houses: hs });
    this.version++;
    return added;
  }

  removeTile(key: string): void {
    const t = this.tiles.get(key);
    if (!t) return;
    for (const b of t.blocks) {
      this.blocks.remove(b.id);
      for (const p of b.pieces) this.pieces.remove(p.id);
    }
    for (const h of t.houses) this.houses.remove(h.id);
    this.tiles.delete(key);
    this.version++;
  }

  /** Houses whose outline comes within `radiusM` of a line. */
  housesNear(coords: number[], bbox: BBox, radiusM: number): Building[] {
    const out: Building[] = [];
    for (const h of this.houses.query(expandBBox(bbox, radiusM))) {
      if (polylineDistanceM(h.coords, coords) <= radiusM) out.push(h);
    }
    return out;
  }
}
