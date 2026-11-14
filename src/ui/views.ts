import { estimateSteps, formatDistance, formatDuration, formatSteps } from '../core/stats';
import type { WalkRecord } from '../core/types';
import { esc, ICONS } from './dom';

// ---- Walk dock ----

export interface LiveView {
  elapsedMs: number;
  distanceM: number;
  gps: { kind: 'searching' | 'ok' | 'weak' | 'vehicle' | 'error'; text: string };
}

export function renderIdleDock(dock: HTMLElement, hint: string, onStart: () => void): void {
  dock.innerHTML = `
    <button class="wl-start" data-start>${ICONS.walk}<span>Start walk</span></button>
    <p class="wl-dock-hint">${esc(hint)}</p>`;
  dock.querySelector('[data-start]')!.addEventListener('click', onStart);
  dock.classList.remove('is-live');
}

/** Distance, estimated steps and time: the same three numbers the summary shows at the end. */
export function renderLiveDock(dock: HTMLElement, onEnd: () => void): void {
  dock.innerHTML = `
    <div class="wl-live">
      <div class="wl-live-gps" data-gps></div>
      <div class="wl-stats">
        <div><b data-dist>0 m</b><span>walked</span></div>
        <div><b data-steps>0</b><span>steps (est.)</span></div>
        <div><b data-time>00:00</b><span>time</span></div>
      </div>
      <button class="wl-end" data-end>End walk</button>
    </div>`;
  dock.querySelector('[data-end]')!.addEventListener('click', onEnd);
  dock.classList.add('is-live');
}

export function updateLiveDock(dock: HTMLElement, v: LiveView): void {
  const set = (sel: string, text: string) => {
    const el = dock.querySelector(sel);
    if (el && el.textContent !== text) el.textContent = text;
  };
  set('[data-dist]', formatDistance(v.distanceM));
  set('[data-steps]', formatSteps(estimateSteps(v.distanceM)));
  set('[data-time]', formatDuration(v.elapsedMs));
  const gps = dock.querySelector<HTMLElement>('[data-gps]');
  if (gps) {
    gps.className = `wl-live-gps is-${v.gps.kind}`;
    if (gps.textContent !== v.gps.text) gps.textContent = v.gps.text;
  }
}

// ---- Walk summary ----

export function summaryHtml(w: WalkRecord, saved: boolean): string {
  return `
    <h2>Walk complete</h2>
    <div class="wl-stats is-summary">
      <div><b>${formatDistance(w.distanceM)}</b><span>walked</span></div>
      <div><b>${formatSteps(estimateSteps(w.distanceM))}</b><span>steps (est.)</span></div>
      <div><b>${formatDuration(w.durationMs)}</b><span>time</span></div>
    </div>
    ${saved ? '' : '<p class="wl-muted">This walk was too short to save.</p>'}
    <button class="wl-primary" data-close>Done</button>`;
}
