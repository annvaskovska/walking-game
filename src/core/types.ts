import type { BBox } from '../geo/geo';

/**
 * How a way takes part in the lighting rule:
 * - `road`: a street you can unlock (its name is written in gold once it is lit).
 * - `path`: a walkable path away from the street grid (courtyard, park, canal side).
 * - `side`: a sidewalk or crossing. It is never lit on its own; the street beside it is.
 */
export type PieceKind = 'road' | 'path' | 'side';

/**
 * One walkable street edge: a stretch of street between two junctions (or a junction and a dead
 * end), cut out of a map tile by `parseTile`. Its id is a hash of its tile and geometry, so the
 * same street gets the same id every time the tile loads.
 */
export interface WayInput {
  id: string;
  name: string | null;
  highway: string;
  kind: PieceKind;
  /** Flat [lon, lat, lon, lat, ...]. */
  coords: number[];
}

/** A ~20 m slice of a way. Its id `wayId:index` is stable for a given way geometry. */
export interface Piece {
  id: string;
  /** Id of the way it was cut from (a number for pieces saved by older versions). */
  way: string | number;
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

/** One building footprint, kept so a lit house can be drawn without the map data. */
export interface Building {
  /** `h<tile>.<centroid>` (or `b<osmId>` for houses saved by older versions). */
  id: string;
  /** Flat closed outer ring [lon, lat, ...]. */
  coords: number[];
  /** Courtyards: flat closed rings, when the footprint has any. */
  holes?: number[][];
  bbox: BBox;
  /** Cached Web-Mercator coordinates for fast drawing (filled lazily, never stored). */
  merc?: Float64Array;
}

/** A house that lit up because a block beside it was unlocked. */
export interface LitHouse extends Building {
  litAt: number;
  /** Id of the block whose unlock switched it on ('' when it arrived late; a number in old saves). */
  block: string | number;
}

/**
 * A landmark from the map tiles: a shop, café, church, school… (OpenMapTiles `poi` layer). Its id
 * comes from its name and position, so it stays the same across map updates.
 */
export interface Place {
  id: string;
  name: string;
  /** OpenMapTiles poi class, e.g. `shop`, `cafe`, `place_of_worship`. */
  cls: string;
  /** OpenMapTiles poi rank: lower is more important. */
  rank: number;
  lon: number;
  lat: number;
  bbox: BBox;
}

/** A house you have seen (but maybe not walked past). Kept with its outline, so it draws anywhere. */
export interface SeenHouse extends Building {
  seenAt: number;
}

/** A landmark you have seen; its label stays on your map. */
export interface SeenPlace extends Place {
  seenAt: number;
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
