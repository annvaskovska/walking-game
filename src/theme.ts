/**
 * The look of the map (ADR 0014): a coloring page of the city, black ink on white paper. Streets you
 * have not walked are faint outlines under a paper wash; what you have seen prints in full ink; every
 * street you walk is colored in, in waxy pencil, for good, with its houses and its name. The start
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
  /** The box of pencils; a street keeps one for good (pencilOf). */
  pencils: Pencil[];
  pencil: {
    /**
     * Half-width of the street a pencil colors in, ground metres (never under a pixel or two). Its
     * scribble swings 1.2 times as far, a little past the lines, as a hand colors in.
     */
    roadM: number;
    pathM: number;
    /** The scribble: metres along the street per stroke across it, and its width (m). */
    strokeM: number;
    strokeWidthM: number;
    /** How hard a house is colored, 0..1. */
    house: number;
    /** Share of walked houses colored with their street's pencil; the others take one of their own. */
    houseMatch: number;
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
    paper: '#fffefb',
    ink: '#111111',
    water: '#eaf5f9',
    park: '#f1f6e6',
    road: '#fffefb',
    place: '#5e5e5e',
    name: '#4a4a4a',
    landmark: '#2b2b2b',
  },
  fog: {
    color: '#fffefb',
    opacity: 0.6,
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
    { lay: '#1fa2e8', press: '#0b6eaa' }, // cerulean
    { lay: '#ff8a1f', press: '#ad4e00' }, // orange
    { lay: '#ee3e9e', press: '#c0157a' }, // magenta
    { lay: '#ffd02e', press: '#836300' }, // sunflower
    { lay: '#c0763e', press: '#97521e' }, // raw sienna
    { lay: '#ff5a6e', press: '#c81e42' }, // watermelon
    { lay: '#8c5cf0', press: '#6c3ed8' }, // violet
    { lay: '#a6d93a', press: '#4a720b' }, // inchworm
    { lay: '#13bfb0', press: '#06756b' }, // turquoise
    { lay: '#be95ff', press: '#7f43e0' }, // lavender
    { lay: '#ffa27f', press: '#b5470f' }, // peach
    { lay: '#3557e6', press: '#2c4ad1' }, // royal blue
    { lay: '#e3256b', press: '#c7185a' }, // razzmatazz
  ],
  pencil: {
    roadM: 3.4,
    pathM: 1.6,
    strokeM: 1.3,
    strokeWidthM: 1.4,
    house: 0.64,
    houseMatch: 0.45,
  },
  seen: {
    clear: 0.92,
    fill: '#fffefb',
    edge: '#111111',
    fillOpacity: 1,
    edgeOpacity: 0.45,
    beamM: 88,
    aroundM: 37,
  },
  puck: {
    wood: '#e9cfa6',
    ink: '#111111',
  },
};

/**
 * The pencil a street keeps for good: a hash of its name, or of its way when it has none, so it
 * comes out the same on every walk and every device. FNV-1a, with a basis picked so each street of
 * the demo walk gets a pencil of its own, and no two of like hue follow each other.
 */
export function pencilOf(key: string, n = paperTheme.pencils.length): number {
  let h = 0x952002b7;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % n;
}

/** The key pencilOf reads for a street piece. */
export const pencilKey = (p: { name: string | null; way: string | number }) => p.name ?? `way ${p.way}`;
