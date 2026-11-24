import { cssFont, paperTheme, pencilOf } from '../theme';
import { waxPattern } from './wax';

/** Two streets colored in a few steps apart: each name gets this long on its own (ms). */
const GAP_MS = 1400;
/** A name stays up this long, then fades (walk.css, 0.45 s). */
const STAY_MS = 4300;
/** A letter every 55 ms; the underline after them takes 360 ms. */
const PER = 55;
const LINE_MS = 360;
/** The band the name is written in: from 56 px down (walk.css), 150 px tall; the baseline in it. */
const BAND = 150;
const BASE = 86;
const HAND = cssFont(paperTheme.font.hand);

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/** The design's seeded xorshift32. */
function rng(seed: number): () => number {
  let s = Math.imul((seed | 0) + 1, 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const easeBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

interface Letter {
  ch: string;
  x: number;
  rot: number;
  dy: number;
  sc: number;
}

interface Writing {
  L: Letter[];
  fs: number;
  lay: string;
  press: string;
  t0: number;
  /** The wavy underline, [x, y, ...] from the baseline. */
  ul: number[];
}

/**
 * The new-street moment (ADR 0014): a street colored in for the first time gets its name written
 * big across the top of the map, letter by letter, in its crayon, with a wavy underline. Names
 * close together wait their turn. Each name, as it is written, is also said to a screen reader and
 * handed to `onClaim` (he pops, a crayon comes out of the box, he says his line).
 */
export class Claims {
  private cv = document.createElement('canvas');
  private ctx = this.cv.getContext('2d')!;
  private live = document.createElement('div');
  private w: Writing | null = null;
  private raf = 0;
  private fade = 0;
  private next = 0;
  private waits: number[] = [];
  /** Streets claimed on this walk, in order. */
  private names = new Set<string>();
  private W = 390;
  private dpr = 1;

  constructor(private onClaim: (name: string, i: number) => void) {
    this.cv.className = 'wl-claim gone';
    this.cv.setAttribute('aria-hidden', 'true');
    this.live.className = 'wl-live';
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    document.body.append(this.cv, this.live);
    // The hand is a web font off Apple's devices: have it here before the first name is written.
    void document.fonts?.load(`700 52px ${HAND}`).catch(() => {});
  }

  /** A street colored in for the first time on this walk. */
  add(name: string): void {
    if (this.names.has(name)) return;
    const i = this.names.size;
    this.names.add(name);
    const now = performance.now(), at = Math.max(now, this.next);
    this.next = at + GAP_MS;
    if (at <= now) this.write(name, i, false);
    else this.waits.push(window.setTimeout(() => this.write(name, i, false), at - now));
  }

  /** A walk carried on after a reload: the streets so far; the last one's name is up, already written. */
  resume(names: string[]): void {
    this.clear();
    for (const n of names) this.names.add(n);
    const last = names.at(-1);
    if (!last) return;
    this.write(last, this.names.size - 1, true);
    this.next = performance.now() + GAP_MS;
  }

  /** The walk is over. */
  clear(): void {
    for (const t of this.waits) clearTimeout(t);
    this.waits = [];
    this.names.clear();
    this.next = 0;
    this.w = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.fade);
    this.cv.classList.add('gone');
    this.live.textContent = '';
  }

  /** `quiet`: arriving mid-walk, the name is already written, and nothing else happens. */
  private write(name: string, i: number, quiet: boolean): void {
    const c = paperTheme.pencils[pencilOf(name)];
    this.live.textContent = `Colored in ${name}.`;
    this.size();
    const ctx = this.ctx, W = this.W;
    let fs = 52;
    ctx.font = `700 ${fs}px ${HAND}`;
    const w0 = ctx.measureText(name).width || name.length * 26;
    if (w0 > W - 64) fs = Math.max(26, (fs * (W - 64)) / w0);
    ctx.font = `700 ${fs}px ${HAND}`;
    const r = rng(i * 31 + name.length);
    const L: Letter[] = [];
    let x = 0;
    for (const ch of name) {
      const cw = ctx.measureText(ch).width || fs * 0.5;
      L.push({ ch, x: x + cw / 2, rot: (r() - 0.5) * 0.2, dy: (r() - 0.5) * 7, sc: 0.93 + r() * 0.14 });
      x += cw * 0.97;
    }
    const start = (W - x) / 2;
    for (const l of L) l.x += start;
    const ul: number[] = [];
    for (let k = 0; k <= 28; k++) {
      const t = k / 28;
      ul.push(start - 8 + t * (x + 18), Math.sin(t * Math.PI * 3.2) * 3.2 + t * 2);
    }
    this.w = { L, fs, lay: c.lay, press: c.press, t0: performance.now() - (quiet ? 1e4 : 0), ul };
    this.cv.classList.remove('gone');
    clearTimeout(this.fade);
    this.fade = window.setTimeout(() => this.cv.classList.add('gone'), STAY_MS);
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
    if (!quiet) this.onClaim(name, i);
  }

  /** The canvas at the width of the screen, in device pixels. */
  private size(): void {
    const W = innerWidth, dpr = Math.min(2, devicePixelRatio || 1);
    if (W === this.W && dpr === this.dpr && this.cv.width) return;
    this.W = W;
    this.dpr = dpr;
    this.cv.width = Math.round(W * dpr);
    this.cv.height = Math.round(BAND * dpr);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const st = this.w;
    if (!st) return;
    const ctx = this.ctx, W = this.W, dpr = this.dpr;
    const n = st.L.length, el = reduced.matches ? 1e9 : now - st.t0;
    const shown = Math.min(n, Math.floor(el / PER) + 1), ulp = Math.max(0, Math.min(1, (el - n * PER) / LINE_MS));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(W / 2, BASE);
    ctx.rotate(-0.045);
    ctx.translate(-W / 2, -BASE);
    ctx.font = `700 ${st.fs.toFixed(1)}px ${HAND}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const each = (fn: (l: Letter) => void) => {
      for (let k = 0; k < shown; k++) {
        const l = st.L[k];
        const pop = el >= n * PER ? 1 : Math.min(1, Math.max(0, (el - k * PER) / (PER * 1.6)));
        const s = l.sc * (0.6 + 0.4 * easeBack(pop));
        ctx.save();
        ctx.translate(l.x, BASE + l.dy);
        ctx.rotate(l.rot);
        ctx.scale(s, s);
        fn(l);
        ctx.restore();
      }
    };
    // A clear patch of paper under the writing, so the name reads over the line art.
    ctx.strokeStyle = 'rgba(255,254,251,.94)';
    ctx.lineWidth = 12;
    each((l) => ctx.strokeText(l.ch, 0, 0));
    if (ulp > 0) {
      const u = st.ul, upto = Math.max(2, Math.round((u.length / 2) * ulp));
      const line = () => {
        ctx.beginPath();
        ctx.moveTo(u[0], BASE + 14 + u[1]);
        for (let k = 1; k < upto; k++) ctx.lineTo(u[k * 2], BASE + 14 + u[k * 2 + 1]);
      };
      line();
      ctx.lineWidth = 10;
      ctx.stroke();
      line();
      ctx.strokeStyle = waxPattern(ctx, st.lay, dpr);
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    // A wax copy a little off register, then the name pressed hard on top.
    ctx.fillStyle = waxPattern(ctx, st.lay, dpr);
    each((l) => ctx.fillText(l.ch, 1.3, 1));
    ctx.fillStyle = waxPattern(ctx, st.press, dpr, true);
    each((l) => ctx.fillText(l.ch, 0, 0));
    ctx.restore();
    if (el < n * PER + LINE_MS) this.raf = requestAnimationFrame(this.frame);
  };
}
