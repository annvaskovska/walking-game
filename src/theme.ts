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
  lit: { core: string; glow: string; glowOpacity: number };
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

export const nightTheme: Theme = {
  name: 'night',
  font: {
    ui: "'Outfit', system-ui, -apple-system, 'Segoe UI', sans-serif",
    map: ['Noto Sans Regular'],
    mapBold: ['Noto Sans Bold'],
  },
  radius: { sm: 10, md: 16, lg: 24, pill: 999 },
  color: {
    bg: '#080c1a',
    surface: '#121931',
    surface2: '#1b2443',
    line: 'rgba(255,255,255,0.08)',
    text: '#eef1ff',
    textDim: '#a3abcf',
    textFaint: '#626b93',
    accent: '#ffb38a',
    accentInk: '#2b1408',
    lit: '#8ef0cf',
    litInk: '#062a20',
    warn: '#ffd38a',
    danger: '#ff9a9a',
    shadow: 'rgba(0,0,0,0.45)',
  },
  fog: {
    color: '#060918',
    opacity: 0.97,
    ghost: 'rgba(142,240,207,0.16)',
    ghostWidthPx: 1.4,
    corridorM: 22,
    minCorridorPx: 7,
    lanternM: 38,
  },
  lit: { core: '#d8fff1', glow: '#8ef0cf', glowOpacity: 0.55 },
  user: { dot: '#ffb38a', ring: 'rgba(255,179,138,0.18)', cone: 'rgba(255,179,138,0.35)' },
  map: {
    background: '#1d2742',
    residential: '#212c4a',
    park: '#1f4a3f',
    wood: '#1c4238',
    water: '#1f4a78',
    waterway: '#2a5a8c',
    building: '#2b375a',
    buildingEdge: '#35426a',
    roadCasing: '#141b31',
    roadMinor: '#3d4a72',
    roadMajor: '#59648f',
    roadPath: '#4b5a85',
    rail: '#3a4363',
    label: '#e3e8ff',
    labelHalo: '#121a33',
    placeLabel: '#fff1e8',
  },
};

export let theme: Theme = nightTheme;

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
