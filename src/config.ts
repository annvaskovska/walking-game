/** Tunable numbers for tracking, lighting, street loading and step estimates. No colours here: see theme.ts. */
export const CONFIG = {
  /** Target length of one street piece, in metres. */
  pieceLengthM: 20,

  /** Fixes with a worse accuracy than this (metres) are ignored. */
  maxAccuracyM: 35,
  /** Radius around a walked step used to look for the street being walked. */
  radiusFactor: 0.8,
  radiusMinM: 12,
  radiusMaxM: 25,

  /**
   * A street is "walked along" when the walked step stays within this lateral distance of it
   * (metres) and advances along it, rather than across it.
   */
  walkAlongRadiusM: 20,
  /** Share of a walked step that must advance along a street for it to count as walking along it. */
  walkAlongFactor: 0.6,
  /** The step must advance at least this far (m) along the street. */
  walkAlongMinM: 1,
  /** A parallel street farther than the nearest one by more than this (m) was not walked. */
  parallelTieM: 5,
  /** An untagged footway this close (m) to a road being walked is that road's sidewalk. */
  sideNearRoadM: 10,

  /** Share of a block's length that must be walked along before the whole block unlocks. */
  blockUnlockFraction: 0.5,
  /** Even a tiny block needs this much walked-along length (or its whole length, if shorter). */
  blockMinCoverM: 8,
  /** A block is also cut at least this often (m), so long ways unlock in stages. */
  maxBlockLengthM: 160,

  /** Houses within this distance (m) of an unlocked block light their windows. */
  houseRadiusM: 30,
  /** How long a freshly unlocked street or house stays cream before settling to gold (ms). */
  freshMs: 3000,
  /** Buildings are fetched and cached by z16 cells, about 0.4 km across. */
  buildingCellZoom: 16,

  /** Straight-line speed over the speed window above this (m/s) means a vehicle: nothing lights. */
  walkMaxSpeedMps: 4,
  /** A single hop faster than this (m/s) that is larger than the GPS noise is a glitch. */
  jumpMaxSpeedMps: 7,
  /** Window used to judge sustained speed. */
  speedWindowMs: 20_000,
  /** The window must span at least this long before it can call "vehicle". */
  minWindowMs: 8_000,
  /** After this long without a usable fix, a far-away fix starts a new chain instead of a segment. */
  gapResetMs: 60_000,
  gapResetMinM: 100,
  /** After this many glitches in a row, trust the new position. */
  rejectStreakReset: 5,
  /** Moves shorter than clamp(accuracy * 0.5, min, max) are treated as standing still (no distance). */
  minMoveMinM: 3,
  minMoveMaxM: 10,

  /** Slippy-map zoom of the grid cells streets are fetched and cached by. */
  cellZoom: 15,

  /** A walk shorter than this (and lighting nothing) is not saved. */
  minSavedWalkM: 50,

  /** Average adult walking step, metres. Steps are estimated as distance / this. */
  stepLengthM: 0.75,
} as const;

export type Config = typeof CONFIG;
