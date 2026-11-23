/**
 * The look of the map (ADR 0014): a pencil drawing of the city on warm paper. Streets you have not
 * walked are faint outlines under a paper wash; what you have seen prints in full ink; every street
 * you walk is colored in with a colored pencil, for good, with its houses and its name. The start
 * screen, the walk stats and the summary read the same palette as CSS custom properties from the
 * inline style in index.html, which has to paint before any script loads; keep the two in step.
 */
export interface Pencil {
  /** How the pencil colors: multiplied over the paper and the ink, so lines stay black. */
  lay: string;
  /** The same pencil pressed hard: dark enough for text on paper (at least 4.5:1). */
  press: string;
}

export interface Theme {
  font: {
    /** Names of the streets you walked, in their pencil: Instrument Serif in italic (style.ts fontFaces). */
    walked: string[];
    /** Names of the streets you have seen: the same italic, in ink. */
    names: string[];
    /** District names and landmarks: Instrument Sans. */
    places: string[];
  };
  map: {
    paper: string;
    ink: string;
    water: string;
    park: string;
    /** The streets' inside, cut back to paper inside an ink casing, so crossings stay open. */
    road: string;
    place: string;
    /** Street names you have seen but not walked. */
    name: string;
    /** Landmarks you have seen. */
    landmark: string;
  };
  /** The paper wash over what you have not seen, and the light that clears it. */
  fog: {
    color: string;
    /** How much of the line art the wash hides where you have not been. */
    opacity: number;
    /** Half-width of the clear corridor around a walked street / path, ground metres. */
    roadM: number;
    pathM: number;
    /** Clear margin around a walked house, metres. */
    houseM: number;
    /** Your sight: a clear disc around you, and a cone ahead while you move. */
    lanternM: number;
    coneM: number;
    /** Outer half-angle of the cone (where it has faded out) and inner one (full strength). */
    coneHalfDeg: number;
    coneInnerDeg: number;
    /**
     * Sight stops at walls. Size of the eye as a light source (m): the bigger, the softer the
     * edge of a shadow, which widens with distance behind the wall.
     */
    lampRadiusM: number;
    /** Speed at which a street colors in along its block, m/s. */
    sweepMps: number;
  };
  /** The box of colored pencils; a street keeps one for good (pencilOf). */
  pencils: Pencil[];
  pencil: {
    /** Half-width colored along a street and a path, ground metres (never under a pixel or two). */
    roadM: number;
    pathM: number;
    /** How hard a street and a house are colored, 0..1. */
    street: number;
    house: number;
    /**
     * Every walked house gets the same soft pencil, so the streets carry the colors and a walked
     * block reads as one warm patch, not confetti.
     */
    houseLay: string;
  };
  /** What you have seen but not walked: it stays printed in full ink, for good. */
  seen: {
    /** Share of the wash a fully seen spot clears, 0..1 (walked streets clear all of it). */
    clear: number;
    /** A house you have seen: paper roof and an ink outline over the wash. */
    fill: string;
    edge: string;
    fillOpacity: number;
    edgeOpacity: number;
    /**
     * How far sight is remembered (m): in the cone ahead of you, and all around you. Houses and
     * landmarks hit by your sight within this reach become seen.
     */
    beamM: number;
    aroundM: number;
  };
  /** Mr Sparkles on the map: a colored pencil, in the pencil of the street he colors now. */
  puck: {
    wood: string;
    ink: string;
  };
}

export const paperTheme: Theme = {
  font: {
    walked: ['Instrument Serif Italic', 'Instrument Serif', 'ui-serif', 'New York', 'Iowan Old Style', 'Georgia', 'Noto Serif', 'serif'],
    names: ['Instrument Serif Italic', 'Instrument Serif', 'ui-serif', 'New York', 'Iowan Old Style', 'Georgia', 'Noto Serif', 'serif'],
    places: ['Instrument Sans', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
  },
  map: {
    paper: '#f6f2e9',
    ink: '#24221f',
    water: '#e2eaec',
    park: '#ebeedd',
    road: '#fbf9f4',
    place: '#6b665d',
    name: '#5c5750',
    landmark: '#3d3a35',
  },
  fog: {
    color: '#f6f2e9',
    opacity: 0.8,
    roadM: 17,
    pathM: 11,
    houseM: 7,
    lanternM: 40,
    coneM: 110,
    coneHalfDeg: 38,
    coneInnerDeg: 19,
    lampRadiusM: 1.5,
    sweepMps: 50,
  },
  pencils: [
    { lay: '#3f78b5', press: '#1f4f86' }, // Prussian blue
    { lay: '#e2603f', press: '#a8361c' }, // vermilion
    { lay: '#e3a634', press: '#7c5508' }, // ochre
    { lay: '#7aa654', press: '#3f6322' }, // sap green
    { lay: '#d0628a', press: '#9a2f57' }, // rose madder
    { lay: '#8a70c6', press: '#56409a' }, // violet
    { lay: '#3fa196', press: '#1d645c' }, // teal
    { lay: '#c27646', press: '#83461d' }, // burnt sienna
    { lay: '#5aaed8', press: '#22668d' }, // cerulean
    { lay: '#a9a03e', press: '#5e5a12' }, // olive
  ],
  pencil: {
    roadM: 4.2,
    pathM: 2,
    street: 0.92,
    house: 0.42,
    houseLay: '#c98f5a',
  },
  seen: {
    clear: 0.92,
    fill: '#f6f2e9',
    edge: '#24221f',
    fillOpacity: 1,
    edgeOpacity: 0.45,
    beamM: 88,
    aroundM: 37,
  },
  puck: {
    wood: '#e9cfa6',
    ink: '#24221f',
  },
};

/**
 * The pencil a street keeps for good: a hash of its name, or of its way when it has none, so it
 * comes out the same on every walk and every device. FNV-1a, with a basis picked so the demo walk's
 * first eight streets each get a pencil of their own, and no two of like hue follow each other.
 */
export function pencilOf(key: string, n = paperTheme.pencils.length): number {
  let h = 0x67f26257;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % n;
}

/** The key pencilOf reads for a street piece. */
export const pencilKey = (p: { name: string | null; way: string | number }) => p.name ?? `way ${p.way}`;
