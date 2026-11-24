/**
 * The look of the app (ADR 0014): a coloring book of the city, black ink on white paper, every street
 * you walk colored in with crayon for good, with its houses and its name. The cover in index.html,
 * which has to paint before any script loads, repeats the type and the crayons it needs inline; keep
 * the two in step.
 */
export interface Pencil {
  /** How the pencil colors: multiplied over the paper and the ink, so lines stay black. */
  lay: string;
  /** The same pencil pressed hard: dark enough for text on paper (at least 4.5:1). */
  press: string;
}

export interface Theme {
  font: {
    /**
     * The hand, a marker: street names, the claim lettering, titles and numbers. Marker Felt on
     * Apple's devices, Kalam Bold elsewhere (style.ts fontFaces, index.html --hand).
     */
    hand: string[];
    /** The kid, a chalk hand: everything you read and tap. Chalkboard SE, or Patrick Hand. */
    kid: string[];
  };
  /**
   * The printed page: every line in ink on paper, no tints (style.ts). The streets' insides are cut
   * back to paper inside their ink casings, so crossings stay open.
   */
  map: {
    paper: string;
    ink: string;
  };
  /** Your sight, which the seen memory remembers; and how fast a walked street colors in. */
  fog: {
    /** A disc around you, and a cone ahead while you move, metres. */
    lanternM: number;
    coneM: number;
    /** Outer half-angle of the cone (where it has faded out) and inner one (full strength). */
    coneHalfDeg: number;
    coneInnerDeg: number;
    /** Speed at which a street colors in up to you, m/s; from there it keeps your pace. */
    sweepMps: number;
  };
  /** The box of pencils; a street keeps one for good (pencilOf). */
  pencils: Pencil[];
  pencil: {
    /**
     * How wide a crayon colors a street in, units (1.495 m in Amsterdam), by its class: the
     * design's WCLS, as the map prints them (style.ts). Any other street, and a path.
     */
    width: Record<string, number>;
    road: number;
    path: number;
    /** Share of walked houses colored with their street's crayon; the others take one of their own. */
    houseMatch: number;
  };
  /** What you have seen, remembered for the landmarks you spot. */
  seen: {
    /**
     * How far sight is remembered (m): in the cone ahead of you, and all around you. Houses and
     * landmarks hit by your sight within this reach become seen.
     */
    beamM: number;
    aroundM: number;
  };
}

export const paperTheme: Theme = {
  font: {
    hand: ['Marker Felt', 'Kalam', 'Chalkboard SE', 'Noteworthy', 'Comic Sans MS', 'cursive'],
    kid: ['Chalkboard SE', 'Chalkboard', 'Patrick Hand', 'Noteworthy', 'Comic Sans MS', 'cursive'],
  },
  map: {
    paper: '#fffefb',
    ink: '#000000',
  },
  fog: {
    lanternM: 40,
    coneM: 110,
    coneHalfDeg: 38,
    coneInnerDeg: 19,
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
    width: {
      motorway: 7, trunk: 7, primary: 7, secondary: 6.4, tertiary: 5.6, minor: 4.4, service: 3.2,
      busway: 4.6, track: 3, pedestrian: 3.8,
    },
    road: 4.2,
    path: 2.4,
    houseMatch: 0.45,
  },
  seen: {
    beamM: 88,
    aroundM: 37,
  },
};

/** A font stack as CSS, for a 2D canvas. */
export const cssFont = (stack: string[]) => stack.map((f) => (/^[\w-]+$/.test(f) ? f : `"${f}"`)).join(', ');

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
