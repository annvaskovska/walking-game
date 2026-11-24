import type { Place } from '../core/types';

const CLAIM_LINES = ['Colored in!', "That one's ours for good.", 'Another street, colored in!', 'Look how bright it is now!', 'Ooh, a new color!'];

/** What he says about a new street: the `i`th colored in on this walk. */
export function streetLine(name: string, i: number): string {
  if (i === 0) return 'Here we go! First street.';
  if (/sluis$|brug$/i.test(name)) return 'A bridge! Colored in.';
  return CLAIM_LINES[i % CLAIM_LINES.length];
}

/** What he says about a place he spots, by its OpenMapTiles class. */
export function placeLine(p: Pick<Place, 'name' | 'cls'>): string {
  const n = p.name;
  switch (p.cls) {
    case 'cafe': return `${n}. Coffee later?`;
    case 'restaurant': case 'fast_food': case 'ice_cream': return `Ooh, ${n}.`;
    case 'bar': case 'beer': case 'alcohol_shop': return `${n}. Cheers!`;
    case 'bakery': return `Mmm, ${n}.`;
    case 'art_gallery': case 'museum': case 'theatre': return `Art! ${n}.`;
    case 'attraction': return `Look, ${n}!`;
    case 'hairdresser': return `${n}. Snip snip.`;
    case 'library': case 'school': case 'college': return `Books! ${n}.`;
    default: return `Spotted: ${n}.`;
  }
}

interface Line {
  text: string;
  prio: number;
  hold: number;
  at: number;
}

type Point = { x: number; y: number };

/**
 * Mr Sparkles talks (ADR 0014): a speech bubble over his head. New streets (priority 3) and
 * attractions (2) wait their turn, up to 3 of them, for at most 4 s; a passing cafe (1) is only
 * mentioned when he is free and has been quiet for 1.6 s. Asleep, a Zzz floats up from his head.
 */
export class Bubble {
  private el = document.createElement('div');
  private zzz = document.createElement('div');
  private until = 0;
  private prio = 0;
  private quietUntil = 0;
  private timer = 0;
  private waiting: Line[] = [];
  private bw = 160;
  private bh = 40;

  /**
   * `locate`: where his tip is on the screen now, CSS px. `onLine`: a line of this priority went up
   * (he looks the part: hearts for a landmark, priority 2).
   */
  constructor(private locate: () => Point | null, private onLine: (prio: number) => void = () => {}) {
    this.el.className = 'wl-bubble';
    this.zzz.className = 'wl-zzz';
    this.zzz.innerHTML = '<span>z</span><span>z</span><span>z</span>';
    for (const e of [this.el, this.zzz]) e.setAttribute('aria-hidden', 'true');
    document.body.append(this.el, this.zzz);
  }

  /** Is it or the Zzz up? The frame loop then keeps them over his head (place). */
  get up(): boolean {
    return this.el.classList.contains('on') || this.zzz.classList.contains('on');
  }

  /** He is asleep, or awake again. */
  sleep(on: boolean): void {
    if (on === this.zzz.classList.contains('on')) return;
    this.zzz.classList.toggle('on', on);
    const p = this.locate();
    if (on && p) this.place(p);
  }

  /** What he says when you tap him: at once, over anything but a new street, and never queued. */
  react(text: string, hold: number): void {
    if (performance.now() < this.until && this.prio >= 3) return;
    this.until = 0;
    this.say(text, 2.5, hold);
  }

  street(name: string, i: number, hold = 2000): void {
    this.say(streetLine(name, i), 3, hold);
  }

  spotted(p: Pick<Place, 'name' | 'cls'>): void {
    this.say(placeLine(p), p.cls === 'attraction' ? 2 : 1, 1700);
  }

  say(text: string, prio: number, hold: number): void {
    const now = performance.now();
    if (now < this.until && prio <= this.prio) {
      if (prio >= 2 && this.waiting.length < 3) this.waiting.push({ text, prio, hold, at: now });
      return;
    }
    if (prio < 2 && (now < this.quietUntil || now < this.until)) return;
    this.el.textContent = text;
    this.bw = this.el.offsetWidth || 160;
    this.bh = this.el.offsetHeight || 40;
    this.el.classList.add('on');
    this.until = now + hold;
    this.prio = prio;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(this.done, hold);
    const p = this.locate();
    if (p) this.place(p);
    this.onLine(prio);
  }

  /** Above his head, the tail pointing down at him, 12 px inside the screen's edges. */
  place({ x, y }: Point): void {
    const { bw, bh } = this;
    const bx = Math.max(12, Math.min(innerWidth - bw - 12, x - 26)), by = Math.max(bh + 60, y - 48);
    this.el.style.transform = `translate(${bx.toFixed(0)}px, ${(by - bh).toFixed(0)}px)`;
    this.el.style.setProperty('--tail', `${Math.max(10, Math.min(bw - 24, x - bx - 7)).toFixed(0)}px`);
    this.zzz.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }

  /** The walk is over. */
  clear(): void {
    clearTimeout(this.timer);
    this.waiting = [];
    this.until = this.prio = this.quietUntil = 0;
    this.el.classList.remove('on');
    this.zzz.classList.remove('on');
  }

  private done = () => {
    const now = performance.now();
    this.until = this.prio = 0;
    while (this.waiting.length && now - this.waiting[0].at > 4000) this.waiting.shift();
    const next = this.waiting.shift();
    if (next) return this.say(next.text, next.prio, next.hold);
    this.el.classList.remove('on');
    this.quietUntil = now + 1600;
  };
}
