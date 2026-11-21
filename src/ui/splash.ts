import { estimateSteps, formatDistance, formatDuration, formatSteps } from '../core/stats';
import type { WalkRecord } from '../core/types';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const html = document.documentElement;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

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
 * The one screen besides the map: logo, what Wanderlight is, and Start. Its markup lives in
 * index.html so it paints before any script loads; this drives it once the app is up. After a
 * walk it shows what the walk lit, over the map.
 */
export class Splash {
  private go = byId<HTMLButtonElement>('wl-go');
  private msg = byId('wl-msg');
  private stats = byId('wl-stats');
  private card = document.querySelector('.wl-card') as HTMLElement;

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
    this.stats.innerHTML = `<b>${l.streets}</b> street${l.streets === 1 ? '' : 's'} lit · <b>${l.km}</b> km walked`;
    this.stats.hidden = false;
  }

  /** Back to the first screen. */
  intro(): void {
    this.card.classList.remove('wl-summary');
    this.go.textContent = this.sim ? 'Start the demo walk' : 'Start the walk';
  }

  /** What the walk that just ended lit up. */
  summary({ walk, newHouses }: WalkSummary): void {
    byId('wl-sum-title').textContent = walk.newPieces > 0 ? 'Walk complete' : 'Walk ended';
    byId('wl-sum-dist').textContent = formatDistance(walk.distanceM);
    byId('wl-sum-time').textContent = formatDuration(walk.durationMs);
    byId('wl-sum-steps').textContent = formatSteps(estimateSteps(walk.distanceM));
    const streets = walk.newStreets;
    let line: string;
    if (streets.length) {
      const shown = streets.slice(0, 3).map((s) => `<b>${esc(s)}</b>`);
      const more = streets.length > 3 ? ` and ${streets.length - 3} more` : '';
      const houses = newHouses ? `, and ${newHouses} house${newHouses === 1 ? '' : 's'}` : '';
      line = `New: ${shown.join(', ')}${more}${houses}.`;
    } else if (walk.newPieces > 0) {
      line = `You lit new stretches${newHouses ? ` and ${newHouses} house${newHouses === 1 ? '' : 's'}` : ''}.`;
    } else {
      line = 'Walk along a street to light it.';
    }
    byId('wl-sum-new').innerHTML = line;
    this.card.classList.add('wl-summary');
    this.go.textContent = 'Walk again';
  }
}
