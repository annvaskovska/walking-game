import { distanceParts, estimateSteps, formatDurationWords, formatSteps } from '../core/stats';
import type { WalkRecord } from '../core/types';
import { newOnMap } from './summaryText';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const html = document.documentElement;

export interface Lifetime {
  streets: number;
  km: string;
}

/** What a finished walk added, for the summary. */
export interface WalkSummary {
  walk: WalkRecord;
  newHouses: number;
}

/**
 * The one screen besides the map: a question, one line on Mr Sparkles, and Start, over your map or,
 * before your first walk, over a drawing of the demo city. Its markup and that drawing live in
 * index.html and public/ so they paint before any script loads; this drives the screen once the
 * app is up. After a walk it shows, over the map, how far you went and what the walk colored in.
 */
export class Splash {
  private go = byId<HTMLButtonElement>('wl-go');
  private msg = byId('wl-msg');
  private stats = byId('wl-stats');
  private card = document.querySelector('.wl-card') as HTMLElement;
  private sum = document.querySelector('.wl-sum') as HTMLElement;

  constructor(private sim: boolean) {}

  onStart(fn: () => void): void {
    this.go.addEventListener('click', fn);
  }

  get visible(): boolean {
    return !html.classList.contains('wl-walking');
  }

  show(): void {
    html.classList.remove('wl-walking');
    this.busy(false);
  }

  hide(): void {
    html.classList.add('wl-walking');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  /** The map is drawn behind the screen (there is somewhere to show). */
  overMap(on: boolean): void {
    html.classList.toggle('wl-has-map', on);
  }

  busy(on: boolean): void {
    if (on) this.go.setAttribute('aria-busy', 'true');
    else this.go.removeAttribute('aria-busy');
  }

  /** A problem to explain (trusted HTML), or null. */
  message(markup: string | null): void {
    this.msg.hidden = !markup;
    this.msg.innerHTML = markup ?? '';
  }

  setLifetime(l: Lifetime): void {
    if (l.streets <= 0) {
      this.stats.hidden = true;
      return;
    }
    this.stats.innerHTML = `<b>${l.streets}</b> street${l.streets === 1 ? '' : 's'} colored in · <b>${l.km}</b> km walked`;
    this.stats.hidden = false;
  }

  /** Back to the first screen. */
  intro(): void {
    this.card.classList.remove('wl-summary');
    this.go.textContent = this.sim ? 'Start the demo walk' : 'Start walking';
  }

  /** How far the walk that just ended went, and what it colored in. */
  summary({ walk, newHouses }: WalkSummary): void {
    const d = distanceParts(walk.distanceM);
    byId('wl-sum-dist').textContent = d.value;
    byId('wl-sum-unit').textContent = d.unit;
    const steps = estimateSteps(walk.distanceM);
    byId('wl-sum-sub').textContent =
      `${formatDurationWords(walk.durationMs)} · ${formatSteps(steps)} step${steps === 1 ? '' : 's'}`;
    const lit = newOnMap(walk, newHouses);
    const names = byId('wl-sum-names');
    names.textContent = lit.names ?? '';
    names.hidden = !lit.names;
    names.toggleAttribute('data-long', lit.long);
    const more = byId('wl-sum-more');
    more.textContent = lit.more;
    more.hidden = !lit.more;
    byId('wl-sum-label').hidden = lit.empty;
    this.sum.toggleAttribute('data-empty', lit.empty);
    this.card.classList.add('wl-summary');
    this.go.textContent = 'Walk again';
  }
}
