import { estimateSteps, formatDistance, formatDuration, formatSteps } from '../core/stats';
import { paperTheme, pencilOf } from '../theme';
import { crayonSVG } from './art';
import { waxURL } from './wax';
import css from './walk.css?inline';

// Everything over the map during a walk (the crayon box, the lettering, his bubble, the toasts) is
// styled here: none of it is on the first paint, so it comes with the app (ADR 0007).
document.head.append(Object.assign(document.createElement('style'), { textContent: css }));

/** How long End waits for its second tap (ms). */
const CONFIRM_MS = 3500;
/** The box holds 13 crayons, this far apart (px). */
const SLOTS = 13;
const GAP = Math.min(16.1, 206 / SLOTS);

/** The design's integer hash, 0..1: each crayon's tilt. */
function hash(i: number): number {
  let x = Math.imul((i | 0) + 1, 374761393);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const TRAY = `<div class="wl-box">
  <svg viewBox="0 0 238 132" aria-hidden="true"><rect x="5" y="30" width="228" height="100" rx="5" fill="#e9ad00" stroke="#000" stroke-width="2.6"/></svg>
  <div class="wl-crayons" aria-hidden="true"></div>
  <svg viewBox="0 0 238 132" aria-hidden="true">
    <path d="M2 52 Q119 78 236 52 L236 128 Q236 131 233 131 L5 131 Q2 131 2 128 Z" fill="#ffd23f" stroke="#000" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M9 63 Q119 88 229 63" fill="none" stroke="#000" stroke-width="1.2" stroke-dasharray="3 3"/>
  </svg>
  <dl class="wl-readout" aria-label="This walk">
    <div><dt>time</dt><dd>0:00</dd></div>
    <div><dt>distance</dt><dd>0 m</dd></div>
    <div><dt>steps</dt><dd>0</dd></div>
  </dl>
</div>
<button class="wl-end crayon-btn" type="button"><span>End</span></button>`;

/**
 * The walk's readout and its only control (ADR 0015): a crayon box at the bottom, up for the whole
 * walk, with time, distance and steps on its front. Each street colored in on this walk pops a
 * crayon up out of it, in that street's crayon. End asks for a second tap, so a stray touch in a
 * pocket can't end a walk. The perforated left edge of the page and the map credits come with it.
 */
export class Hud {
  private el = document.createElement('div');
  private perf = document.createElement('div');
  private crayonsEl: HTMLElement;
  private dd: HTMLElement[];
  private end: HTMLButtonElement;
  private label: HTMLElement;
  private credit = document.getElementById('wl-credit')!;
  private names = new Set<string>();
  private shown = ['', '', ''];
  private fit = 1;
  private creditTimer = 0;
  private armTimer = 0;
  private tick = 0;
  private read: () => { elapsedMs: number; distanceM: number } = () => ({ elapsedMs: 0, distanceM: 0 });

  constructor(onEnd: () => void) {
    this.el.className = 'wl-tray';
    this.el.innerHTML = TRAY;
    this.el.hidden = true;
    this.perf.className = 'wl-perf';
    this.perf.setAttribute('aria-hidden', 'true');
    this.perf.hidden = true;
    document.body.append(this.perf, this.el);
    this.crayonsEl = this.el.querySelector('.wl-crayons')!;
    this.dd = [...this.el.querySelectorAll('dd')];
    this.end = this.el.querySelector('.wl-end')!;
    this.label = this.end.querySelector('span')!;
    this.end.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.end.classList.contains('armed')) {
        this.disarm();
        onEnd();
        return;
      }
      this.end.classList.add('armed');
      this.end.style.setProperty('--tex', `url(${waxURL('#ff5a6e')})`); // watermelon
      this.label.textContent = 'End walk?';
      this.end.setAttribute('aria-label', 'End walk? Press again to end it.');
      clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => this.disarm(), CONFIRM_MS);
    });
  }

  /** Where the numbers come from. */
  source(read: () => { elapsedMs: number; distanceM: number }): void {
    this.read = read;
  }

  /** Up for the walk. */
  show(): void {
    this.update();
    this.el.hidden = this.perf.hidden = false;
    if (!this.tick) this.tick = window.setInterval(() => this.update(), 1000);
  }

  /** The map credits, for a few seconds. */
  showCredit(ms: number): void {
    this.credit.hidden = false;
    clearTimeout(this.creditTimer);
    this.creditTimer = window.setTimeout(() => (this.credit.hidden = true), ms);
  }

  /** The walk is over: the box goes, emptied. */
  hideAll(): void {
    clearInterval(this.tick);
    this.tick = 0;
    this.el.hidden = this.perf.hidden = true;
    this.disarm();
    this.crayons([]);
    clearTimeout(this.creditTimer);
    this.credit.hidden = true;
  }

  /** The streets colored in on this walk so far, each a crayon out of the box, without a pop. */
  crayons(names: string[]): void {
    this.names.clear();
    this.crayonsEl.replaceChildren();
    for (const n of names) this.add(n)?.classList.add('out');
  }

  /** A street colored in: its crayon pops up out of the box. */
  pop(name: string): void {
    const el = this.add(name);
    if (!el) return;
    void el.offsetWidth; // from inside the box
    el.classList.add('out');
  }

  private add(name: string): HTMLElement | null {
    const i = this.names.size;
    if (i >= SLOTS || this.names.has(name)) return null;
    this.names.add(name);
    const el = document.createElement('span');
    el.className = 'wl-cr';
    el.style.left = `${(16 + i * GAP).toFixed(1)}px`;
    el.style.setProperty('--r', `${((hash(i * 5) - 0.5) * 10).toFixed(1)}deg`);
    el.innerHTML = crayonSVG(paperTheme.pencils[pencilOf(name)]);
    this.crayonsEl.append(el);
    return el;
  }

  private update(): void {
    const { elapsedMs, distanceM } = this.read();
    const now = [formatDuration(elapsedMs), formatDistance(distanceM), formatSteps(estimateSteps(distanceM))];
    now.forEach((v, i) => {
      if (v !== this.shown[i]) this.dd[i].textContent = this.shown[i] = v;
    });
    // The design's box fits 17 characters at 21 px ("12:11", "1.02 km", "1,365"); a walk of an hour
    // or of 10 km has more, so the numbers shrink to fit rather than run into each other.
    const fit = Math.min(1, 17 / now.join('').length);
    if (fit !== this.fit) this.dd.forEach((d) => (d.style.fontSize = (this.fit = fit) < 1 ? `${(21 * fit).toFixed(1)}px` : ''));
  }

  private disarm(): void {
    clearTimeout(this.armTimer);
    this.end.classList.remove('armed');
    this.end.style.removeProperty('--tex');
    this.end.removeAttribute('aria-label');
    this.label.textContent = 'End';
  }
}
