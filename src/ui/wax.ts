import { makeTooth } from '../map/fog/fogLayer';

/** The paper's tooth: a seamless 256 px mask the crayon skips over (ADR 0015). */
const TN = 256;
let tooth: Uint8Array | null = null;
const canvases = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | string>>();

/**
 * A crayon's wax on the paper: its color where the tooth takes it. Coloring uses the full tooth
 * (about a quarter of the paper shows through); writing is pressed hard (`dense`), at least 90%
 * cover, so press colors stay above 4.5:1 on the paper.
 */
export function waxCanvas(hex: string, dense = false): HTMLCanvasElement {
  const key = hex + (dense ? 'd' : '');
  const hit = canvases.get(key);
  if (hit) return hit;
  tooth ??= makeTooth(TN);
  const cv = document.createElement('canvas');
  cv.width = cv.height = TN;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(TN, TN);
  const d = img.data;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  for (let i = 0; i < TN * TN; i++) {
    const t = tooth[i] / 255;
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = Math.round((dense ? 0.9 + 0.1 * t : t) * 255);
  }
  ctx.putImageData(img, 0, 0);
  canvases.set(key, cv);
  return cv;
}

/** The wax as an image URL, for CSS (the crayon buttons). */
export function waxURL(hex: string): string {
  let u = urls.get(hex);
  if (u === undefined) {
    try {
      u = waxCanvas(hex).toDataURL();
    } catch {
      u = '';
    }
    urls.set(hex, u);
  }
  return u;
}

/**
 * A crayon fill for a 2D canvas, one tooth texel per device pixel whatever the transform:
 * `kp` is device pixels per unit of the context's current transform.
 */
export function waxPattern(ctx: CanvasRenderingContext2D, hex: string, kp: number, dense = false): CanvasPattern | string {
  let cache = patterns.get(ctx);
  if (!cache) patterns.set(ctx, (cache = new Map()));
  const key = `${hex}${dense ? 'd' : ''}${kp}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let p: CanvasPattern | string = hex;
  try {
    const made = ctx.createPattern(waxCanvas(hex, dense), 'repeat');
    if (made) {
      made.setTransform?.(new DOMMatrix([1 / kp, 0, 0, 1 / kp, 0, 0]));
      p = made;
    }
  } catch {
    /* the plain color */
  }
  cache.set(key, p);
  return p;
}
