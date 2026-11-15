/**
 * Every colour, font and radius lives here. The UI reads them as CSS custom properties
 * (see applyTheme) and the map style, fog and glow read them directly, so a new skin is one
 * object away.
 */
export interface Theme {
  name: string;
  font: {
    ui: string;
    /** Fontstacks served by OpenFreeMap. */
    map: string[];
    mapBold: string[];
  };
  radius: { sm: number; md: number; lg: number; pill: number };
  color: {
    bg: string;
    surface: string;
    surface2: string;
    line: string;
    text: string;
    textDim: string;
    textFaint: string;
    accent: string;
    accentInk: string;
    lit: string;
    litInk: string;
    warn: string;
    danger: string;
    shadow: string;
  };
  fog: {
    color: string;
    opacity: number;
    /** Unlit streets hinted on the fog. */
    ghost: string;
    ghostWidthPx: number;
    /** Half-width of the clear corridor around a lit piece, metres (soft edge goes beyond). */
    corridorM: number;
    minCorridorPx: number;
    /** Soft glow cleared around you during a walk, metres. */
    lanternM: number;
  };
  lit: {
    /** Soft halo under a lit street. */
    glow: string;
    glowOpacity: number;
    /** Street line once it has settled, and the cream it flashes when it unlocks. */
    street: string;
    streetFresh: string;
    /** Thin highlight running along the middle of a lit street. */
    shine: string;
    /** Street names, written over their lit street. */
    name: string;
    nameHalo: string;
    /** Houses: settled gold, the flash when their block unlocks, edge and halo. */
    house: string;
    houseFresh: string;
    houseEdge: string;
    houseGlow: string;
    /** The little window pattern repeated over a lit house. */
    windowBase: string;
    windowLight: string;
    windowBright: string;
  };
  user: { dot: string; ring: string; cone: string };
  map: {
    background: string;
    residential: string;
    park: string;
    wood: string;
    water: string;
    waterway: string;
    building: string;
    buildingEdge: string;
    roadCasing: string;
    roadMinor: string;
    roadMajor: string;
    roadPath: string;
    rail: string;
    label: string;
    labelHalo: string;
    placeLabel: string;
  };
}

/**
 * Bare-bones look: neutral greys, warm lamplight for lit streets, a blue "you are here" dot and
 * the system font. A designed skin replaces this object once a direction is chosen.
 */
export const plainTheme: Theme = {
  name: 'plain',
  font: {
    ui: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    map: ['Noto Sans Regular'],
    mapBold: ['Noto Sans Bold'],
  },
  radius: { sm: 8, md: 12, lg: 18, pill: 999 },
  color: {
    bg: '#0e0e10',
    surface: '#19191c',
    surface2: '#242428',
    line: 'rgba(255,255,255,0.08)',
    text: '#f2f2f3',
    textDim: '#a1a1a8',
    textFaint: '#6b6b73',
    accent: '#f2f2f3',
    accentInk: '#111113',
    lit: '#ffd27a',
    litInk: '#2a1d00',
    warn: '#f5c26b',
    danger: '#ff8a80',
    shadow: 'rgba(0,0,0,0.5)',
  },
  fog: {
    color: '#0a0a0c',
    opacity: 0.96,
    ghost: 'rgba(255,255,255,0.12)',
    ghostWidthPx: 1.4,
    // Wide enough to read as one unlocked block, with the houses at its edge fully in the clear.
    corridorM: 15,
    minCorridorPx: 7,
    lanternM: 38,
  },
  lit: {
    glow: '#ffd27a',
    glowOpacity: 0.45,
    street: '#ffc85a',
    streetFresh: '#fff6dc',
    shine: '#fffaf0',
    name: '#ffd27a',
    nameHalo: '#1b1406',
    house: '#e9a13f',
    houseFresh: '#fff3cf',
    houseEdge: '#ffe6a8',
    houseGlow: '#ffb547',
    windowBase: '#d98f2f',
    windowLight: '#ffe9b3',
    windowBright: '#fff8e0',
  },
  user: { dot: '#4ea1ff', ring: 'rgba(78,161,255,0.18)', cone: 'rgba(78,161,255,0.35)' },
  map: {
    background: '#26262a',
    residential: '#2a2a2f',
    park: '#26332b',
    wood: '#243028',
    water: '#23303d',
    waterway: '#2c3c4d',
    building: '#333338',
    buildingEdge: '#3c3c42',
    roadCasing: '#1a1a1d',
    roadMinor: '#4a4a50',
    roadMajor: '#5e5e66',
    roadPath: '#55555c',
    rail: '#404046',
    label: '#e6e6e8',
    labelHalo: '#1a1a1d',
    placeLabel: '#f2f2f3',
  },
};

export let theme: Theme = plainTheme;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/** Write the theme to CSS custom properties on :root. */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  theme = t;
  for (const [k, v] of Object.entries(t.color)) root.style.setProperty(`--${kebab(k)}`, v);
  for (const [k, v] of Object.entries(t.radius)) root.style.setProperty(`--radius-${k}`, `${v}px`);
  root.style.setProperty('--font-ui', t.font.ui);
  root.style.setProperty('--fog', t.fog.color);
  root.style.setProperty('--user-dot', t.user.dot);
  root.style.setProperty('--user-ring', t.user.ring);
  root.style.setProperty('--user-cone', t.user.cone);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.color.bg);
}
