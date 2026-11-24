import { distanceParts, estimateSteps, formatDurationWords, formatSteps } from '../core/stats';
import type { WalkRecord } from '../core/types';
import { paperTheme, pencilOf, type Pencil } from '../theme';
import { mrInner, setWax, wearAfter } from './art';
import css from './fridge.css?inline';
import { newOnMap } from './summaryText';
import { waxURL } from './wax';

/** The design's seeded jitter (xorshift), so a heading wobbles the same way every time. */
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

/** A street's swatch: a zigzag of its crayon. */
const ZIGZAG = 'M2 10 L6 3 L9 11 L13 3 L16 11 L20 3 L23 11 L27 3 L31 10';

/** How long the cover takes to turn back over the fridge (ms), as in index.html. */
const COVER_TURN_MS = 900;
/** The longest the sheet waits for the map to draw its page before it drops on without it (ms). */
const PAGE_WAIT_MS = 1200;

/**
 * After a walk: its page, colored in, stuck on the fridge with a magnet (ADR 0014). The page is
 * the map itself: the app frames the walk behind the fridge and hands its canvas to paint().
 */
export class Fridge {
  private el = document.createElement('section');
  private q = <T extends Element = HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private timer = 0;

  constructor() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    this.el.className = 'fridge';
    this.el.hidden = true;
    this.el.setAttribute('aria-labelledby', 'wl-wow');
    this.el.innerHTML = `<div class="handle" aria-hidden="true"></div>
      <div class="sheet-wrap">
        <div class="magnet" aria-hidden="true"></div>
        <article class="sheet">
          <h2 class="wow" id="wl-wow" tabindex="-1"></h2>
          <div class="pagemap"><canvas role="img" aria-label="Your page, colored in where you walked."></canvas></div>
          <p class="dist"><span class="wl-vh"></span><span aria-hidden="true"></span><small aria-hidden="true"></small></p>
          <p class="meta"></p>
          <h3 class="newh">New on your map</h3>
          <ul class="newl"></ul>
          <p class="more"></p>
        </article>
      </div>
      <div class="below">
        <button class="again crayon-btn" type="button">Walk again</button>
        <div class="mr-fridge" aria-hidden="true"><span class="say">Fridge-worthy!</span><svg viewBox="0 0 60 100"></svg></div>
      </div>`;
    document.body.append(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  onAgain(fn: () => void): void {
    this.q('.again').addEventListener('click', fn);
  }

  /** Puts the walk's page on the fridge; `last` is the crayon Mr Sparkles ended the walk in. */
  show(walk: WalkRecord, newHouses: number, last: Pencil): void {
    clearTimeout(this.timer);
    const lit = newOnMap(walk, newHouses);

    const wow = this.q('.wow');
    wow.setAttribute('aria-label', lit.head);
    const r = rng(walk.newStreets.length + 3);
    // Each word in a box of its own, so "Wow," sits on its own line; each letter jittered.
    wow.innerHTML = lit.head
      .split(' ')
      .map((word) => `<span aria-hidden="true">${[...word].map((ch) => `<span class="wx" style="--r:${((r() - 0.5) * 12).toFixed(1)}deg;--y:${((r() - 0.5) * 5).toFixed(1)}px">${ch}</span>`).join('')}</span>`)
      .join(' ');
    setWax(wow, last);

    this.q<HTMLCanvasElement>('.pagemap canvas').width = 0;

    const d = distanceParts(walk.distanceM);
    const [whole, frac] = d.value.split('.');
    const [said, shown, unit] = this.q('.dist').children;
    said.textContent = `${d.value} ${d.unit}`;
    const pt = document.createElement('span');
    pt.className = 'pt';
    shown.replaceChildren(whole, ...(frac ? [pt, frac] : []));
    unit.textContent = d.unit;
    const steps = estimateSteps(walk.distanceM);
    this.q('.meta').textContent = `${formatDurationWords(walk.durationMs)} of walking, ${formatSteps(steps)} step${steps === 1 ? '' : 's'}`;

    this.q('.newh').hidden = lit.empty;
    this.q('.newl').replaceChildren(
      ...lit.names.map((name) => {
        // A street's own crayon; stretches of street in the one he ended in.
        const c = walk.newStreets.length ? paperTheme.pencils[pencilOf(name)] : last;
        const li = document.createElement('li');
        li.innerHTML = `<svg viewBox="0 0 34 14" aria-hidden="true"><path d="${ZIGZAG}" fill="none" stroke="${c.lay}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" filter="url(#wax)"/></svg><span></span>`;
        li.lastElementChild!.textContent = name;
        return li;
      }),
    );
    this.q('.more').textContent = lit.more;

    const again = this.q('.again');
    if (!again.style.getPropertyValue('--tex')) again.style.setProperty('--tex', `url(${waxURL(paperTheme.pencils[0].lay)})`);
    const mr = this.q<SVGSVGElement>('.mr-fridge svg');
    mr.innerHTML = mrInner(Math.max(0.55, wearAfter(walk.distanceM)), true);
    setWax(mr, last);

    // The sheet waits for its page to be drawn, or a moment at most, then drops on.
    this.el.classList.remove('drop');
    this.el.classList.add('wait');
    this.el.hidden = false;
    this.el.scrollTop = 0;
    this.timer = window.setTimeout(() => this.drop(), PAGE_WAIT_MS);
    document.getElementById('map')?.setAttribute('inert', '');
    wow.focus({ preventScroll: true });
  }

  /** The sheet drops onto the door and the magnet clacks on (in place with reduced motion: fridge.css). */
  private drop(): void {
    clearTimeout(this.timer);
    if (!this.el.classList.contains('wait')) return;
    this.el.classList.remove('wait');
    void this.el.offsetWidth;
    this.el.classList.add('drop');
  }

  /** The page's size in CSS pixels, to frame the walk into. */
  pageSize(): { w: number; h: number } {
    const box = this.q('.pagemap');
    return { w: box.clientWidth, h: box.clientHeight };
  }

  /** Copies the middle of `src` (the map, the walk framed in its middle) onto the page, pixel for pixel. */
  paint(src: HTMLCanvasElement): void {
    const { w, h } = this.pageSize();
    const k = src.width / (src.clientWidth || src.width);
    const cv = this.q<HTMLCanvasElement>('.pagemap canvas');
    cv.width = Math.round(w * k);
    cv.height = Math.round(h * k);
    cv.getContext('2d')?.drawImage(src, Math.round((src.width - cv.width) / 2), Math.round((src.height - cv.height) / 2), cv.width, cv.height, 0, 0, cv.width, cv.height);
    this.drop();
  }

  /** Takes the page down; `underCover`: once the cover has turned back over it. */
  hide(underCover = false): void {
    clearTimeout(this.timer);
    const off = () => {
      this.el.hidden = true;
      document.getElementById('map')?.removeAttribute('inert');
    };
    if (underCover && !matchMedia('(prefers-reduced-motion: reduce)').matches) this.timer = window.setTimeout(off, COVER_TURN_MS);
    else off();
  }
}
