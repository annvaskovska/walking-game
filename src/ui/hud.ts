import { estimateSteps, formatDistance, formatDuration, formatSteps } from '../core/stats';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** How long the walk stats stay up after a tap, and how long End waits for its second tap (ms). */
const SHOW_MS = 4000;
const CONFIRM_MS = 3000;

/**
 * The walk's only control: a small pill with time, distance and steps, and End. It is hidden; a
 * tap on the map brings it up for a few seconds. End asks for a second tap, so a stray touch in
 * a pocket can't end a walk. The map credits come up with it.
 */
export class Hud {
  private el = byId('wl-hud');
  private time = byId('wl-hud-time');
  private dist = byId('wl-hud-dist');
  private steps = byId('wl-hud-steps');
  private end = byId<HTMLButtonElement>('wl-end');
  private credit = byId('wl-credit');
  private hideTimer = 0;
  private creditTimer = 0;
  private armTimer = 0;
  private tick = 0;
  private read: () => { elapsedMs: number; distanceM: number } = () => ({ elapsedMs: 0, distanceM: 0 });

  constructor(onEnd: () => void) {
    this.end.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.end.dataset.armed !== undefined) {
        this.disarm();
        onEnd();
        return;
      }
      this.end.dataset.armed = '';
      this.end.textContent = 'End walk?';
      clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => this.disarm(), CONFIRM_MS);
      this.show(CONFIRM_MS + 1000);
    });
    // Touching the pill keeps it up.
    this.el.addEventListener('pointerdown', () => this.show());
  }

  /** Where the numbers come from. */
  source(read: () => { elapsedMs: number; distanceM: number }): void {
    this.read = read;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(ms = SHOW_MS): void {
    this.update();
    this.el.hidden = false;
    this.showCredit(ms);
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), ms);
    if (!this.tick) this.tick = window.setInterval(() => this.update(), 1000);
  }

  hide(): void {
    clearTimeout(this.hideTimer);
    clearInterval(this.tick);
    this.tick = 0;
    this.el.hidden = true;
    this.disarm();
  }

  /** The map credits alone, e.g. for the first seconds of a walk. */
  showCredit(ms: number): void {
    this.credit.hidden = false;
    clearTimeout(this.creditTimer);
    this.creditTimer = window.setTimeout(() => (this.credit.hidden = true), ms);
  }

  hideAll(): void {
    this.hide();
    clearTimeout(this.creditTimer);
    this.credit.hidden = true;
  }

  private update(): void {
    const { elapsedMs, distanceM } = this.read();
    this.time.textContent = formatDuration(elapsedMs);
    this.dist.textContent = formatDistance(distanceM);
    const steps = estimateSteps(distanceM);
    this.steps.textContent = `${formatSteps(steps)} step${steps === 1 ? '' : 's'}`;
  }

  private disarm(): void {
    clearTimeout(this.armTimer);
    delete this.end.dataset.armed;
    this.end.textContent = 'End';
  }
}
