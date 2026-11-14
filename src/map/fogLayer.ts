import { MercatorCoordinate, type Map as MlMap } from 'maplibre-gl';
import { toMercator, type BBox } from '../geo/geo';
import type { Piece } from '../core/types';
import type { Theme } from '../theme';

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const RAD = Math.PI / 180;

export interface FogSources {
  /** Unlit pieces in a box (drawn faintly on the fog as hints). */
  ghost(b: BBox): Iterable<Piece>;
  /** Lit pieces in a box (cut out of the fog). */
  lit(b: BBox): Iterable<Piece>;
  /** Where to hold the lantern (your position during a walk), or null. */
  lantern(): { lon: number; lat: number } | null;
  /** Changes whenever any of the above changes. */
  version(): number;
}

/** Soft edge: wide faint passes first, a fully clearing core last. */
const CUT_PASSES: [width: number, alpha: number][] = [
  [2.6, 0.14], [2.1, 0.2], [1.7, 0.28], [1.35, 0.42], [1, 1],
];

/**
 * A 2D canvas laid over the map that paints fog everywhere, sketches unlit streets as ghosts,
 * then erases soft corridors (destination-out) around lit pieces so the real map shows through.
 * It redraws inside MapLibre's render event, so it moves in the same frame as the map, and only
 * draws what is in view. Rotation and pitch are disabled, so screen = (mercator - origin) * scale.
 */
export class FogLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private lastKey = '';
  /** Draw statistics, for the debug handle. */
  stats = { ghost: 0, lit: 0, ms: 0, frames: 0 };

  constructor(private map: MlMap, private theme: Theme, private sources: FogSources) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wl-fog';
    this.ctx = this.canvas.getContext('2d')!;
    const container = map.getCanvasContainer();
    container.insertBefore(this.canvas, map.getCanvas().nextSibling);
    this.resize();
    map.on('resize', () => {
      this.resize();
      this.invalidate();
    });
    map.on('render', () => this.draw());
  }

  invalidate(): void {
    this.lastKey = '';
    this.map.triggerRepaint();
  }

  private resize(): void {
    const c = this.map.getCanvas();
    const w = c.clientWidth, h = c.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  private draw(): void {
    const map = this.map;
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    if (!w || !h) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    const lantern = this.sources.lantern();
    const key = `${center.lng},${center.lat},${zoom},${w},${h},${this.sources.version()},${lantern?.lon},${lantern?.lat}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const t0 = performance.now();

    const tl = map.unproject([0, 0]);
    const br = map.unproject([w, h]);
    const m0 = MercatorCoordinate.fromLngLat(tl);
    const m1 = MercatorCoordinate.fromLngLat(br);
    const sx = w / (m1.x - m0.x), sy = h / (m1.y - m0.y);
    const ox = m0.x, oy = m0.y;
    const mpp = (EARTH_CIRCUMFERENCE_M * Math.cos(center.lat * RAD)) / sx;
    const pad = 0.15;
    const dLon = (br.lng - tl.lng) * pad, dLat = (tl.lat - br.lat) * pad;
    const view: BBox = [tl.lng - dLon, br.lat - dLat, br.lng + dLon, tl.lat + dLat];

    const ctx = this.ctx;
    const f = this.theme.fog;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = f.opacity;
    ctx.fillStyle = f.color;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pathOf = (pieces: Iterable<Piece>): [Path2D, number] => {
      const path = new Path2D();
      let n = 0;
      for (const p of pieces) {
        const m = (p.merc ??= toMercator(p.coords));
        path.moveTo((m[0] - ox) * sx, (m[1] - oy) * sy);
        for (let i = 2; i < m.length; i += 2) path.lineTo((m[i] - ox) * sx, (m[i + 1] - oy) * sy);
        n++;
      }
      return [path, n];
    };

    // Ghost hints of the streets you haven't met (only when zoomed in enough to be readable).
    let ghostN = 0;
    if (zoom >= 13.5) {
      const [ghost, n] = pathOf(this.sources.ghost(view));
      ghostN = n;
      ctx.strokeStyle = f.ghost;
      ctx.lineWidth = f.ghostWidthPx * (zoom >= 16 ? 1.5 : 1);
      ctx.stroke(ghost);
    }

    // Cut the fog open around everything you've walked.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    const [lit, litN] = pathOf(this.sources.lit(view));
    const core = Math.max((2 * f.corridorM) / mpp, f.minCorridorPx);
    if (litN) {
      for (const [k, a] of CUT_PASSES) {
        ctx.globalAlpha = a;
        ctx.lineWidth = core * k;
        ctx.stroke(lit);
      }
    }
    if (lantern) {
      const m = MercatorCoordinate.fromLngLat([lantern.lon, lantern.lat]);
      const x = (m.x - ox) * sx, y = (m.y - oy) * sy;
      const r = Math.max(f.lanternM / mpp, 26);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.stats = { ghost: ghostN, lit: litN, ms: performance.now() - t0, frames: this.stats.frames + 1 };
  }
}
