import type { BBox } from '../geo/geo';

/** One OSM way as fetched from Overpass, reduced to what the app needs. */
export interface WayInput {
  id: number;
  name: string | null;
  highway: string;
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
