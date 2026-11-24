import { CONFIG } from '../config';
import { waxPattern } from '../ui/wax';

/**
 * The printed parts of the coloring page that are drawings, not lines: the place pictograms, the
 * Westertoren, the waves in the water and the cloud trees in the parks (ADR 0014). Ported from the
 * design's drawIcon, drawTower, drawPlace, wave and cloud, in its units: 1 unit is 1.495 m in
 * Amsterdam, KC CSS px at the walk zoom. Drawn on a canvas at style load and added to the map as
 * images, since there is no sprite to download (ADR 0007).
 */

/** CSS px per unit at the walk zoom: the design's scale. */
export const KC = 2.25;
/** A pen line never thins below this many CSS px per unit when the map zooms out (the design's summary page). */
export const PEN_FLOOR = 1.09;
/** CSS px per unit at a zoom. */
export const unitPx = (z: number) => KC * 2 ** (z - CONFIG.walkZoom);

type Kind = 'cup' | 'plate' | 'mug' | 'bread' | 'frame' | 'scissors' | 'book' | 'flag' | 'church' | 'bag' | 'dot' | 'tower';

/** The pictogram of each OpenMapTiles poi class that has one; any other place is a dot. */
export const KIND_OF: Readonly<Record<string, Kind>> = {
  cafe: 'cup',
  restaurant: 'plate', fast_food: 'plate', ice_cream: 'plate',
  bar: 'mug', beer: 'mug', alcohol_shop: 'mug',
  bakery: 'bread',
  art_gallery: 'frame', museum: 'frame', theatre: 'frame',
  hairdresser: 'scissors',
  library: 'book', school: 'book', college: 'book',
  attraction: 'flag',
  place_of_worship: 'church',
  shop: 'bag', clothing_store: 'bag', grocery: 'bag', butcher: 'bag', bicycle: 'bag', music: 'bag', car: 'bag', pharmacy: 'bag',
};
/** The places printed on every page: the design's NICE set, and the shops. */
export const PRINTED = [
  'cafe', 'bakery', 'bar', 'beer', 'restaurant', 'art_gallery', 'museum', 'attraction', 'place_of_worship', 'library', 'ice_cream', 'theatre',
  ...Object.keys(KIND_OF).filter((c) => KIND_OF[c] === 'bag'),
];
/** The one landmark with a drawing of its own. */
export const TOWER = 'Westertoren';
/** The tower stands on its point, from its ball 28.5 units up to its foot 6 down: its image is centred this many CSS px above it at the walk zoom. */
export const TOWER_RISE = 11.25 * KC;
/** Seen places come in a few hatchings, so two cafés are not colored in the same. */
export const HATCHINGS = 3;

export const iconKind = (cls: string, name: string): Kind => (name === TOWER ? 'tower' : (KIND_OF[cls] ?? 'dot'));

/** The crayon a seen place is colored in with, by its pictogram. */
const PLACE_COL: Record<Kind, string> = {
  cup: '#ff8a1f', plate: '#ff5a6e', mug: '#ffd02e', bread: '#c0763e', frame: '#8c5cf0', scissors: '#13bfb0',
  book: '#3557e6', flag: '#1fa2e8', church: '#be95ff', bag: '#ee3e9e', dot: '#13bfb0', tower: '#c0763e',
};

// ---- The design's helpers, verbatim ----

function rng(seed: number): () => number {
  let s = Math.imul((seed | 0) + 1, 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Back-and-forth hatching over a box, at an angle, `sp` apart. */
function hatchZ(bb: number[], ang: number, sp: number, r: () => number): number[] {
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]) {
    const u = x * c + y * s, v = -x * s + y * c;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  u0 -= 0.6; u1 += 0.6;
  const out: number[] = [];
  for (let v = v0 + sp * 0.4, k = 0; v <= v1 + sp * 0.5; v += sp, k++) {
    const ua = (k & 1 ? u1 : u0) + (r() - 0.5) * 0.5, ub = (k & 1 ? u0 : u1) + (r() - 0.5) * 0.5, vb = v + sp * 0.5;
    out.push(ua * c - v * s, ua * s + v * c, ub * c - vb * s, ub * s + vb * c);
  }
  return out;
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, bx = x + Math.cos(a) * r * 0.6, by = y + Math.sin(a) * r * 0.6;
    if (i === 0) ctx.moveTo(bx + Math.cos(a - 1.3) * r * 0.45, by + Math.sin(a - 1.3) * r * 0.45);
    ctx.arc(bx, by, r * 0.45, a - 1.3, a + 1.3);
  }
  ctx.closePath();
}

function wave(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.moveTo(x - 3, y);
  ctx.quadraticCurveTo(x - 1.5, y - 1.5, x, y);
  ctx.quadraticCurveTo(x + 1.5, y + 1.5, x + 3, y);
}

const towerRects = (x: number, b: number) => [[x - 4.4, b - 9, 8.8, 9], [x - 3.5, b - 15.5, 7, 6.5], [x - 2.7, b - 20.5, 5.4, 5], [x - 1.9, b - 24.2, 3.8, 3.7]];

function towerCrown(ctx: CanvasRenderingContext2D, x: number, b: number): void {
  ctx.moveTo(x - 2.3, b - 24.2); ctx.lineTo(x - 2.7, b - 27.4); ctx.lineTo(x - 1.2, b - 26.2); ctx.lineTo(x, b - 28.2);
  ctx.lineTo(x + 1.2, b - 26.2); ctx.lineTo(x + 2.7, b - 27.4); ctx.lineTo(x + 2.3, b - 24.2); ctx.closePath();
}

function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const b = y + 5;
  ctx.lineWidth = 0.5;
  ctx.fillStyle = '#fff';
  for (const r of towerRects(x, b)) {
    ctx.beginPath(); ctx.rect(r[0], r[1], r[2], r[3]); ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); towerCrown(ctx, x, b); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, b - 28.2); ctx.lineTo(x, b - 31.4); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, b - 32, 0.6, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 1.2, b); ctx.lineTo(x - 1.2, b - 3); ctx.arc(x, b - 3, 1.2, Math.PI, 0); ctx.lineTo(x + 1.2, b);
  ctx.moveTo(x - 0.9, b - 10); ctx.lineTo(x - 0.9, b - 12.6); ctx.arc(x, b - 12.6, 0.9, Math.PI, 0); ctx.lineTo(x + 0.9, b - 10);
  ctx.moveTo(x + 1.5, b - 18); ctx.arc(x, b - 18, 1.5, 0, Math.PI * 2);
  ctx.moveTo(x, b - 18); ctx.lineTo(x, b - 19.1); ctx.moveTo(x, b - 18); ctx.lineTo(x + 0.8, b - 18);
  ctx.stroke();
}

function drawIcon(ctx: CanvasRenderingContext2D, kind: Kind, x: number, y: number): void {
  if (kind === 'tower') {
    drawTower(ctx, x, y);
    return;
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, 3.3, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 0.42;
  ctx.beginPath();
  switch (kind) {
    case 'cup':
      ctx.moveTo(x - 2.1, y - 1); ctx.lineTo(x + 1.5, y - 1); ctx.lineTo(x + 1.1, y + 1.9); ctx.lineTo(x - 1.7, y + 1.9); ctx.closePath();
      ctx.moveTo(x + 1.4, y - 0.4); ctx.quadraticCurveTo(x + 2.7, y - 0.2, x + 1.25, y + 1.1);
      ctx.moveTo(x - 0.8, y - 1.7); ctx.quadraticCurveTo(x - 1.4, y - 2.4, x - 0.6, y - 3);
      ctx.moveTo(x + 0.4, y - 1.7); ctx.quadraticCurveTo(x - 0.2, y - 2.4, x + 0.6, y - 3);
      break;
    case 'plate':
      ctx.moveTo(x + 2.6, y); ctx.arc(x + 0.4, y, 2.2, 0, Math.PI * 2);
      ctx.moveTo(x + 1.5, y); ctx.arc(x + 0.4, y, 1.1, 0, Math.PI * 2);
      ctx.moveTo(x - 2.6, y - 2.3); ctx.lineTo(x - 2.6, y + 2.4);
      ctx.moveTo(x - 3.1, y - 2.3); ctx.lineTo(x - 3.1, y - 1); ctx.lineTo(x - 2.1, y - 1); ctx.lineTo(x - 2.1, y - 2.3);
      break;
    case 'mug':
      ctx.rect(x - 1.9, y - 1.4, 3.2, 3.6);
      ctx.moveTo(x + 1.3, y - 0.7); ctx.quadraticCurveTo(x + 2.9, y - 0.4, x + 1.3, y + 1.4);
      ctx.moveTo(x - 1.9, y - 1.4); ctx.arc(x - 1.3, y - 1.6, 0.6, Math.PI, 0); ctx.arc(x - 0.1, y - 1.7, 0.65, Math.PI, 0); ctx.arc(x + 0.9, y - 1.6, 0.45, Math.PI, 0);
      break;
    case 'bread':
      ctx.moveTo(x - 2.7, y + 1.5); ctx.quadraticCurveTo(x - 2.8, y - 2.2, x, y - 2); ctx.quadraticCurveTo(x + 2.8, y - 2.2, x + 2.7, y + 1.5); ctx.closePath();
      ctx.moveTo(x - 1.3, y - 0.9); ctx.lineTo(x - 0.6, y + 0.3); ctx.moveTo(x + 0.2, y - 1.1); ctx.lineTo(x + 0.9, y + 0.1);
      break;
    case 'bag':
      ctx.rect(x - 2, y - 0.9, 4, 3.2);
      ctx.moveTo(x - 1, y - 0.9); ctx.quadraticCurveTo(x, y - 3.4, x + 1, y - 0.9);
      break;
    case 'frame':
      ctx.rect(x - 2.5, y - 1.9, 5, 3.8);
      ctx.moveTo(x - 1.8, y + 1.2); ctx.lineTo(x - 0.6, y - 0.4); ctx.lineTo(x + 0.2, y + 0.5); ctx.lineTo(x + 0.9, y - 0.2); ctx.lineTo(x + 1.8, y + 1.2);
      ctx.moveTo(x + 1.5, y - 1); ctx.arc(x + 1.1, y - 1, 0.4, 0, Math.PI * 2);
      break;
    case 'scissors':
      ctx.moveTo(x - 0.55, y + 1.7); ctx.arc(x - 1.3, y + 1.7, 0.75, 0, Math.PI * 2);
      ctx.moveTo(x + 2.05, y + 1.7); ctx.arc(x + 1.3, y + 1.7, 0.75, 0, Math.PI * 2);
      ctx.moveTo(x - 0.8, y + 1.1); ctx.lineTo(x + 1.2, y - 2.6); ctx.moveTo(x + 0.8, y + 1.1); ctx.lineTo(x - 1.2, y - 2.6);
      break;
    case 'book':
      ctx.moveTo(x, y - 1.4); ctx.quadraticCurveTo(x - 1.4, y - 2.2, x - 2.7, y - 1.6); ctx.lineTo(x - 2.7, y + 1.9);
      ctx.quadraticCurveTo(x - 1.4, y + 1.3, x, y + 2); ctx.quadraticCurveTo(x + 1.4, y + 1.3, x + 2.7, y + 1.9);
      ctx.lineTo(x + 2.7, y - 1.6); ctx.quadraticCurveTo(x + 1.4, y - 2.2, x, y - 1.4); ctx.lineTo(x, y + 2);
      break;
    case 'flag':
      ctx.moveTo(x - 1.6, y + 2.7); ctx.lineTo(x - 1.6, y - 2.7); ctx.lineTo(x + 2.5, y - 1.6); ctx.lineTo(x - 1.6, y - 0.5);
      break;
    case 'church':
      ctx.moveTo(x - 2.2, y + 2.3); ctx.lineTo(x - 2.2, y - 0.2); ctx.lineTo(x, y - 1.8); ctx.lineTo(x + 2.2, y - 0.2); ctx.lineTo(x + 2.2, y + 2.3); ctx.closePath();
      ctx.moveTo(x, y - 1.8); ctx.lineTo(x, y - 3.1); ctx.moveTo(x - 0.6, y - 2.6); ctx.lineTo(x + 0.6, y - 2.6);
      ctx.moveTo(x - 0.6, y + 2.3); ctx.lineTo(x - 0.6, y + 0.9); ctx.lineTo(x + 0.6, y + 0.9); ctx.lineTo(x + 0.6, y + 2.3);
      break;
    default:
      ctx.moveTo(x + 1.5, y); ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.moveTo(x + 0.4, y); ctx.arc(x, y, 0.4, 0, Math.PI * 2);
  }
  ctx.stroke();
}

/** Crayon hatched into a shape, multiplied over the ink (drawPlace's hatchIn). */
function hatchIn(ctx: CanvasRenderingContext2D, clip: () => void, bb: number[], col: string, seed: number, alpha: number): void {
  const r = rng(seed);
  ctx.save();
  ctx.beginPath(); clip(); ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  // One tooth texel per device pixel at the walk zoom on a 2x screen.
  ctx.strokeStyle = waxPattern(ctx, col, KC * 2);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 0.8;
  const z = hatchZ(bb, -0.6 + (r() - 0.5) * 0.4, 0.7, r);
  ctx.beginPath(); ctx.moveTo(z[0], z[1]);
  for (let i = 2; i < z.length; i += 2) ctx.lineTo(z[i], z[i + 1]);
  ctx.stroke();
  ctx.restore();
}

/** A seen place, colored in a little off register (drawPlace). */
function drawPlace(ctx: CanvasRenderingContext2D, kind: Kind, x: number, y: number, seed: number): void {
  if (kind === 'tower') {
    const b = y + 5.4, sx = 0.5;
    hatchIn(ctx, () => towerRects(x, b).forEach((q) => ctx.rect(q[0] + sx, q[1], q[2], q[3])), [x - 5, b - 25, x + 5, b + 1], '#c0763e', seed, 0.7);
    hatchIn(ctx, () => towerCrown(ctx, x + sx, b - 0.4), [x - 3.4, b - 29, x + 3.4, b - 23.5], '#1fa2e8', seed + 1, 0.85);
    return;
  }
  const r = rng(seed), ox = 0.35 + r() * 0.4, oy = 0.3 + r() * 0.4;
  hatchIn(ctx, () => ctx.arc(x + ox, y + oy, 2.9, 0, Math.PI * 2), [x - 3.5, y - 3.5, x + 4, y + 4], PLACE_COL[kind], seed, 0.8);
}

// ---- The images ----

/** Image pixels per unit of a pictogram: crisp up to a zoom above the walk on a 2x screen. */
const ICON_PX = 9;

/** A drawing on a w × h unit canvas, `px` image pixels per unit, the origin at (ox, oy) units. */
function paint(w: number, h: number, px: number, ox: number, oy: number, draw: (ctx: CanvasRenderingContext2D) => void): ImageData {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = Math.ceil(w * px);
  ctx.canvas.height = Math.ceil(h * px);
  ctx.setTransform(px, 0, 0, px, ox * px, oy * px);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#000';
  draw(ctx);
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export interface InkImage {
  id: string;
  data: ImageData;
  pixelRatio: number;
}

/** The pictogram images: `pic-<kind>` printed, `pic-<kind>-lit-<n>` colored in. */
export const picId = (kind: string, lit = -1) => (lit < 0 ? `pic-${kind}` : `pic-${kind}-lit-${lit}`);

/** Zooms the waves and trees are drawn for, down to the fridge's page; each scales with the map up to the next one. */
export const PATTERN_ZOOMS = [13, 14, 15, 16, 17];
export const patternId = (name: 'waves' | 'trees', z: number) => `${name}-${z}`;

/**
 * Waves and cloud trees as fill patterns. MapLibre draws a pattern at a fixed size between whole
 * zooms, so there is one per whole zoom, drawn at that zoom's scale: together they grow with the map.
 */
function patterns(z: number): InkImage[] {
  // Four image pixels per CSS pixel: the map shrinks them a little rather than blur them up, so the
  // waves and trees stay as crisp as the lines around them.
  const s = unitPx(z), pen = Math.max(1, PEN_FLOOR / s), pr = 4;
  const out: InkImage[] = [];
  // The design's grid: waves every 11 units in rows 8.5 apart, every other row half a step on.
  const W = 44, H = 34;
  let r = rng(11);
  const waves: number[] = [];
  for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) waves.push(j * 11 + (k & 1) * 5.5 + (r() - 0.5) * 3, k * 8.5 + (r() - 0.5) * 2);
  out.push({
    id: patternId('waves', z), pixelRatio: pr,
    data: paint(W, H, s * pr, 0, 0, (ctx) => {
      ctx.beginPath();
      for (let i = 0; i < waves.length; i += 2) for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) wave(ctx, waves[i] + dx, waves[i + 1] + dy);
      ctx.lineWidth = 0.42 * pen;
      ctx.stroke();
    }),
  });
  // Trees every 7.2 units in rows 6.5 apart, 2.3 to 3 units round.
  const TW = 28.8, TH = 26;
  r = rng(12);
  const trees: number[] = [];
  for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) trees.push(j * 7.2 + (k & 1) * 3.6 + (r() - 0.5) * 2, k * 6.5 + (r() - 0.5) * 2, 2.3 + r() * 0.7);
  out.push({
    id: patternId('trees', z), pixelRatio: pr,
    data: paint(TW, TH, s * pr, 0, 0, (ctx) => {
      ctx.beginPath();
      for (let i = 0; i < trees.length; i += 3) for (const dx of [-TW, 0, TW]) for (const dy of [-TH, 0, TH]) cloud(ctx, trees[i] + dx, trees[i + 1] + dy, trees[i + 2]);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 0.4 * pen;
      ctx.stroke();
    }),
  });
  return out;
}

/** Every image the style asks for, drawn once at style load. */
export function inkImages(): InkImage[] {
  const out = PATTERN_ZOOMS.flatMap(patterns);
  const pr = ICON_PX / KC;
  const kinds = [...new Set(Object.values(KIND_OF)), 'dot'] as Kind[];
  for (const kind of kinds) {
    out.push({ id: picId(kind), pixelRatio: pr, data: paint(7.2, 7.2, ICON_PX, 3.6, 3.6, (ctx) => drawIcon(ctx, kind, 0, 0)) });
    // The hatch runs a little past the printed disc, off register.
    for (let n = 0; n < HATCHINGS; n++) {
      out.push({
        id: picId(kind, n), pixelRatio: pr,
        data: paint(9, 9, ICON_PX, 4.5, 4.5, (ctx) => {
          drawIcon(ctx, kind, 0, 0);
          drawPlace(ctx, kind, 0, 0, 101 + n * 37);
        }),
      });
    }
  }
  // The tower, centred TOWER_RISE above its point.
  const rise = TOWER_RISE / KC, half = 17.25;
  out.push({ id: picId('tower'), pixelRatio: pr, data: paint(12, 2 * half, ICON_PX, 6, rise + half, (ctx) => drawTower(ctx, 0, 0)) });
  out.push({
    id: picId('tower', 0), pixelRatio: pr,
    data: paint(12, 2 * half, ICON_PX, 6, rise + half, (ctx) => {
      drawTower(ctx, 0, 0);
      drawPlace(ctx, 'tower', 0, 0, 7);
    }),
  });
  return out;
}
