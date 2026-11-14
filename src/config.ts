/** Tunable numbers for tracking, lighting and street loading. No colours here: see theme.ts. */
export const CONFIG = {
  /** Target length of one street piece, in metres. */
  pieceLengthM: 20,

  /** Fixes with a worse accuracy than this (metres) are ignored. */
  maxAccuracyM: 35,
  /** Lighting radius = clamp(accuracy * factor, min, max) metres. */
  radiusFactor: 0.8,
  radiusMinM: 12,
  radiusMaxM: 25,

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
  /** A walk counts for streaks and time-of-day stamps from this distance. */
  realWalkMinM: 100,
} as const;

export type Config = typeof CONFIG;
