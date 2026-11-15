import type { BBox } from '../geo/geo';

/**
 * How a way takes part in the lighting rule:
 * - `road`: a street you can unlock (its name is written in gold once it is lit).
 * - `path`: a walkable path away from the street grid (courtyard, park, canal side).
 * - `side`: a sidewalk or crossing. It is never lit on its own; the street beside it is.
 */
export type PieceKind = 'road' | 'path' | 'side';

/** One OSM way as fetched from Overpass, reduced to what the app needs. */
export interface WayInput {
  id: number;
  name: string | null;
  highway: string;
  kind: PieceKind;
  /**
   * Distances in metres from the start of the way to nodes shared with another way, i.e. where
   * one city block ends and the next begins. Missing when Overpass sent no node ids.
   */
  junctionsM?: number[];
  /** Flat [lon, lat, lon, lat, ...]. */
  coords: number[];
}

/** A ~20 m slice of a way. Its id `wayId:index` is stable for a given way geometry. */
export interface Piece {
  id: string;
  way: number;
  idx: number;
  name: string | null;
  hw: string;
  kind: PieceKind;
  /** Length in metres. */
  len: number;
  coords: number[];
  bbox: BBox;
  /** Cached Web-Mercator coordinates for fast drawing (filled lazily, never stored). */
  merc?: Float64Array;
}

/** A piece the user has walked. Stored in IndexedDB; carries its geometry so it can draw anywhere. */
export interface LitPiece extends Piece {
  litAt: number;
  /** Number of distinct walks that lit this piece (for a future "often walked" heat colour). */
  visits: number;
  lastWalk: string;
}

/** One OSM building footprint, kept so a lit house can be drawn without the map data. */
export interface Building {
  /** `b<wayId>`; stable for the OSM building. */
  id: string;
  /** Flat closed ring [lon, lat, ...]. */
  coords: number[];
  bbox: BBox;
  /** Cached Web-Mercator coordinates for fast drawing (filled lazily, never stored). */
  merc?: Float64Array;
}

/** A house that lit up because a block beside it was unlocked. */
export interface LitHouse extends Building {
  litAt: number;
  /** OSM id of the street way whose unlock switched it on (0 when it arrived late). */
  block: number;
}

/** A position fix from a location provider. */
export interface Fix {
  lon: number;
  lat: number;
  /** Horizontal accuracy radius in metres. */
  acc: number;
  /** Timestamp in ms. */
  t: number;
  speed?: number | null;
  heading?: number | null;
}

export interface WalkRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  distanceM: number;
  durationMs: number;
  newPieces: number;
  newLenM: number;
  newStreets: string[];
}
