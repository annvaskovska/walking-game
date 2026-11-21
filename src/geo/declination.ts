/**
 * Magnetic declination: how far magnetic north sits east of true north. Phone compasses report
 * magnetic headings while the map and the GPS course use true north, so the beam needs this added.
 * Source: World Magnetic Model WMM2025 (NOAA NCEI / BGS), coefficients from the official WMM2025.COF.
 */

const RAD = Math.PI / 180;

/** The model's epoch and the end of its validity; years outside are clamped to this range. */
const EPOCH = 2025.0;
const VALID_UNTIL = 2030.0;
const MAX_DEGREE = 12;
/** Geomagnetic reference radius of the spherical harmonic expansion, km. */
const REF_RADIUS_KM = 6371.2;
/** WGS84 ellipsoid: GPS latitudes and heights are measured on it. */
const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

/**
 * WMM2025 Gauss coefficients, copied row for row from WMM2025.COF (header "2025.0 WMM-2025
 * 11/13/2024"): for n = 1..12 and m = 0..n, the main field g, h (nT at 2025.0) and their secular
 * variation gDot, hDot (nT/yr).
 */
const COF = new Float64Array([
  -29351.8,     0.0,  12.0,   0.0, // n = 1
   -1410.8,  4545.4,   9.7, -21.5,
   -2556.6,     0.0, -11.6,   0.0, // n = 2
    2951.1, -3133.6,  -5.2, -27.7,
    1649.3,  -815.1,  -8.0, -12.1,
    1361.0,     0.0,  -1.3,   0.0, // n = 3
   -2404.1,   -56.6,  -4.2,   4.0,
    1243.8,   237.5,   0.4,  -0.3,
     453.6,  -549.5, -15.6,  -4.1,
     895.0,     0.0,  -1.6,   0.0, // n = 4
     799.5,   278.6,  -2.4,  -1.1,
      55.7,  -133.9,  -6.0,   4.1,
    -281.1,   212.0,   5.6,   1.6,
      12.1,  -375.6,  -7.0,  -4.4,
    -233.2,     0.0,   0.6,   0.0, // n = 5
     368.9,    45.4,   1.4,  -0.5,
     187.2,   220.2,   0.0,   2.2,
    -138.7,  -122.9,   0.6,   0.4,
    -142.0,    43.0,   2.2,   1.7,
      20.9,   106.1,   0.9,   1.9,
      64.4,     0.0,  -0.2,   0.0, // n = 6
      63.8,   -18.4,  -0.4,   0.3,
      76.9,    16.8,   0.9,  -1.6,
    -115.7,    48.8,   1.2,  -0.4,
     -40.9,   -59.8,  -0.9,   0.9,
      14.9,    10.9,   0.3,   0.7,
     -60.7,    72.7,   0.9,   0.9,
      79.5,     0.0,  -0.0,   0.0, // n = 7
     -77.0,   -48.9,  -0.1,   0.6,
      -8.8,   -14.4,  -0.1,   0.5,
      59.3,    -1.0,   0.5,  -0.8,
      15.8,    23.4,  -0.1,   0.0,
       2.5,    -7.4,  -0.8,  -1.0,
     -11.1,   -25.1,  -0.8,   0.6,
      14.2,    -2.3,   0.8,  -0.2,
      23.2,     0.0,  -0.1,   0.0, // n = 8
      10.8,     7.1,   0.2,  -0.2,
     -17.5,   -12.6,   0.0,   0.5,
       2.0,    11.4,   0.5,  -0.4,
     -21.7,    -9.7,  -0.1,   0.4,
      16.9,    12.7,   0.3,  -0.5,
      15.0,     0.7,   0.2,  -0.6,
     -16.8,    -5.2,  -0.0,   0.3,
       0.9,     3.9,   0.2,   0.2,
       4.6,     0.0,  -0.0,   0.0, // n = 9
       7.8,   -24.8,  -0.1,  -0.3,
       3.0,    12.2,   0.1,   0.3,
      -0.2,     8.3,   0.3,  -0.3,
      -2.5,    -3.3,  -0.3,   0.3,
     -13.1,    -5.2,   0.0,   0.2,
       2.4,     7.2,   0.3,  -0.1,
       8.6,    -0.6,  -0.1,  -0.2,
      -8.7,     0.8,   0.1,   0.4,
     -12.9,    10.0,  -0.1,   0.1,
      -1.3,     0.0,   0.1,   0.0, // n = 10
      -6.4,     3.3,   0.0,   0.0,
       0.2,     0.0,   0.1,  -0.0,
       2.0,     2.4,   0.1,  -0.2,
      -1.0,     5.3,  -0.0,   0.1,
      -0.6,    -9.1,  -0.3,  -0.1,
      -0.9,     0.4,   0.0,   0.1,
       1.5,    -4.2,  -0.1,   0.0,
       0.9,    -3.8,  -0.1,  -0.1,
      -2.7,     0.9,  -0.0,   0.2,
      -3.9,    -9.1,  -0.0,  -0.0,
       2.9,     0.0,   0.0,   0.0, // n = 11
      -1.5,     0.0,  -0.0,  -0.0,
      -2.5,     2.9,   0.0,   0.1,
       2.4,    -0.6,   0.0,  -0.0,
      -0.6,     0.2,   0.0,   0.1,
      -0.1,     0.5,  -0.1,  -0.0,
      -0.6,    -0.3,   0.0,  -0.0,
      -0.1,    -1.2,  -0.0,   0.1,
       1.1,    -1.7,  -0.1,  -0.0,
      -1.0,    -2.9,  -0.1,   0.0,
      -0.2,    -1.8,  -0.1,   0.0,
       2.6,    -2.3,  -0.1,   0.0,
      -2.0,     0.0,   0.0,   0.0, // n = 12
      -0.2,    -1.3,   0.0,  -0.0,
       0.3,     0.7,  -0.0,   0.0,
       1.2,     1.0,  -0.0,  -0.1,
      -1.3,    -1.4,  -0.0,   0.1,
       0.6,    -0.0,  -0.0,  -0.0,
       0.6,     0.6,   0.1,  -0.0,
       0.5,    -0.1,  -0.0,  -0.0,
      -0.1,     0.8,   0.0,   0.0,
      -0.4,     0.1,   0.0,  -0.0,
      -0.2,    -1.0,  -0.1,  -0.0,
      -1.3,     0.1,  -0.0,   0.0,
      -0.7,     0.2,  -0.1,  -0.1,
]);

/** Where (n, m) sits in the triangular arrays below, with (0, 0) first; COF rows start at (1, 0). */
const at = (n: number, m: number): number => (n * (n + 1)) / 2 + m;
const TERMS = at(MAX_DEGREE, MAX_DEGREE) + 1;

/**
 * Recursion factors for Schmidt semi-normalised Legendre functions, computed once.
 * Diagonal: P(n, n) = DIAG[n] cos P(n-1, n-1). Below it:
 * P(n, m) = ALONG[k] sin P(n-1, m) - BACK[k] P(n-2, m).
 */
const DIAG = new Float64Array(MAX_DEGREE + 1);
const ALONG = new Float64Array(TERMS);
const BACK = new Float64Array(TERMS);
for (let n = 1; n <= MAX_DEGREE; n++) {
  // The Schmidt factor is 1 for m = 0 and sqrt(2) above it, so the first step differs.
  DIAG[n] = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
  for (let m = 0; m < n; m++) {
    const norm = Math.sqrt(n * n - m * m);
    ALONG[at(n, m)] = (2 * n - 1) / norm;
    BACK[at(n, m)] = Math.sqrt((n - 1) * (n - 1) - m * m) / norm;
  }
}

/** Scratch reused by every call: Legendre values, their derivatives, cos and sin of m·lon. */
const P = new Float64Array(TERMS);
const DP = new Float64Array(TERMS);
const COS_M = new Float64Array(MAX_DEGREE + 1);
const SIN_M = new Float64Array(MAX_DEGREE + 1);

/**
 * Fill P and DP with the Schmidt semi-normalised associated Legendre functions of sin(lat) and
 * their derivatives by latitude. Differentiating the recursion itself keeps DP finite at the poles,
 * unlike the textbook tan/sec form.
 */
function fillLegendre(sinLat: number, cosLat: number): void {
  P[0] = 1;
  DP[0] = 0;
  for (let n = 1; n <= MAX_DEGREE; n++) {
    for (let m = 0; m < n; m++) {
      const k = at(n, m), k1 = at(n - 1, m);
      const p2 = n - 2 >= m ? P[at(n - 2, m)] : 0;
      const dp2 = n - 2 >= m ? DP[at(n - 2, m)] : 0;
      P[k] = ALONG[k] * sinLat * P[k1] - BACK[k] * p2;
      DP[k] = ALONG[k] * (cosLat * P[k1] + sinLat * DP[k1]) - BACK[k] * dp2;
    }
    const k = at(n, n), kd = at(n - 1, n - 1);
    P[k] = DIAG[n] * cosLat * P[kd];
    DP[k] = DIAG[n] * (cosLat * DP[kd] - sinLat * P[kd]);
  }
}

/** Magnetic declination (degrees, east positive) at a spot on the ground, from the World Magnetic Model 2025. */
export function declinationDeg(lat: number, lon: number, decimalYear: number, altitudeKm = 0): number {
  // Past 2030 the model is stale, not wrong by much: keep using its last year rather than fail.
  const dt = Math.min(Math.max(decimalYear, EPOCH), VALID_UNTIL) - EPOCH;

  // Geodetic (on the WGS84 ellipsoid) to geocentric spherical coordinates.
  const sinLat = Math.sin(lat * RAD), cosLat = Math.cos(lat * RAD);
  const rc = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const p = (rc + altitudeKm) * cosLat;
  const z = (rc * (1 - WGS84_E2) + altitudeKm) * sinLat;
  const r = Math.hypot(p, z);
  const sinC = z / r, cosC = p / r;

  fillLegendre(sinC, cosC);
  const lambda = lon * RAD;
  for (let m = 0; m <= MAX_DEGREE; m++) {
    COS_M[m] = Math.cos(m * lambda);
    SIN_M[m] = Math.sin(m * lambda);
  }

  // North (X'), east (Y') and down (Z') components in the geocentric frame, nT.
  let north = 0, east = 0, down = 0;
  const ratio = REF_RADIUS_KM / r;
  let radial = ratio * ratio;
  for (let n = 1; n <= MAX_DEGREE; n++) {
    radial *= ratio; // (a / r)^(n + 2)
    for (let m = 0; m <= n; m++) {
      const k = at(n, m), row = (k - 1) * 4;
      const g = COF[row] + dt * COF[row + 2];
      const h = COF[row + 1] + dt * COF[row + 3];
      const inPhase = g * COS_M[m] + h * SIN_M[m];
      const quadrature = g * SIN_M[m] - h * COS_M[m];
      north -= radial * inPhase * DP[k];
      east += radial * m * quadrature * P[k];
      down -= radial * (n + 1) * inPhase * P[k];
    }
  }
  east /= cosC;

  // Rotate north back from geocentric to geodetic; east needs no rotation.
  const cosTilt = cosC * cosLat + sinC * sinLat; // cos(geocentric lat - geodetic lat)
  const sinTilt = sinC * cosLat - cosC * sinLat;
  const x = north * cosTilt - down * sinTilt;
  return Math.atan2(east, x) / RAD;
}

/** The decimal year of a date (2026.5 for early July 2026). */
export function decimalYear(d: Date): number {
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  return year + (d.getTime() - start) / (Date.UTC(year + 1, 0, 1) - start);
}
