import { STAMPS, stampById, type StampContext } from '../core/achievements';
import { formatDistance, formatDuration, type DayBar, type Nudge } from '../core/stats';
import type { StampRecord, WalkRecord } from '../core/types';
import { esc, ICONS } from './dom';

// ---- Walk dock ----

export interface LiveView {
  elapsedMs: number;
  distanceM: number;
  newStreets: number;
  newPieces: number;
  gps: { kind: 'searching' | 'ok' | 'weak' | 'vehicle' | 'error'; text: string };
}

export function renderIdleDock(dock: HTMLElement, hint: string, onStart: () => void): void {
  dock.innerHTML = `
    <button class="wl-start" data-start>${ICONS.walk}<span>Start walk</span></button>
    <p class="wl-dock-hint">${esc(hint)}</p>`;
  dock.querySelector('[data-start]')!.addEventListener('click', onStart);
  dock.classList.remove('is-live');
}

export function renderLiveDock(dock: HTMLElement, onEnd: () => void): void {
  dock.innerHTML = `
    <div class="wl-live">
      <div class="wl-live-gps" data-gps></div>
      <div class="wl-live-stats">
        <div><b data-time>00:00</b><span>time</span></div>
        <div><b data-dist>0 m</b><span>walked</span></div>
        <div><b data-streets>0</b><span>new streets</span></div>
        <div><b data-pieces>0</b><span>new pieces</span></div>
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
  set('[data-time]', formatDuration(v.elapsedMs));
  set('[data-dist]', formatDistance(v.distanceM));
  set('[data-streets]', String(v.newStreets));
  set('[data-pieces]', String(v.newPieces));
  const gps = dock.querySelector<HTMLElement>('[data-gps]');
  if (gps) {
    gps.className = `wl-live-gps is-${v.gps.kind}`;
    if (gps.textContent !== v.gps.text) gps.textContent = v.gps.text;
  }
}

// ---- Walk summary ----

export function summaryHtml(w: WalkRecord, saved: boolean): string {
  const streets = w.newStreets.length
    ? `<ul class="wl-street-list">${w.newStreets.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
    : `<p class="wl-muted">No new streets this time — the familiar ones still count${w.newPieces ? ', and you lit new paths' : ''}.</p>`;
  const stamps = w.stamps
    .map((id) => stampById(id))
    .filter((s) => !!s)
    .map((s) => `<div class="wl-mini-stamp"><span>${s!.icon}</span>${esc(s!.title)}</div>`)
    .join('');
  return `
    <div class="wl-sheet-head">
      <div class="wl-kicker">Walk complete</div>
      <h2>${w.newStreets.length ? `You met ${w.newStreets.length} new street${w.newStreets.length === 1 ? '' : 's'}` : 'Nice walk'}</h2>
    </div>
    <div class="wl-summary-stats">
      <div><b>${formatDistance(w.distanceM)}</b><span>walked</span></div>
      <div><b>${formatDuration(w.durationMs)}</b><span>time</span></div>
      <div><b>${w.newPieces}</b><span>new pieces</span></div>
      <div><b>${formatDistance(w.newLenM)}</b><span>newly lit</span></div>
    </div>
    <h3>New streets</h3>
    ${streets}
    ${stamps ? `<h3>Stamps earned</h3><div class="wl-mini-stamps">${stamps}</div>` : ''}
    ${saved ? '' : '<p class="wl-muted">This walk was too short to save.</p>'}
    <button class="wl-primary" data-close>Done</button>`;
}

// ---- Stamps screen ----

export function renderStamps(el: HTMLElement, ctx: StampContext, earned: Map<string, StampRecord>): void {
  const cards = STAMPS.map((s) => {
    const rec = earned.get(s.id);
    const prog = !rec && s.progress ? s.progress(ctx) : null;
    const status = rec
      ? `<span class="wl-stamp-date">${new Date(rec.earnedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>`
      : prog
        ? `<span class="wl-stamp-prog"><i style="width:${Math.round((prog[0] / prog[1]) * 100)}%"></i></span><span class="wl-stamp-date">${prog[0]} / ${prog[1]}</span>`
        : '<span class="wl-stamp-date">Locked</span>';
    return `
      <div class="wl-stamp ${rec ? 'is-earned' : ''}">
        <div class="wl-stamp-icon">${s.icon}</div>
        <div class="wl-stamp-title">${esc(s.title)}</div>
        <div class="wl-stamp-desc">${esc(s.desc)}</div>
        ${status}
      </div>`;
  }).join('');
  el.innerHTML = `
    <div class="wl-screen-inner">
      <h1>Stamps</h1>
      <p class="wl-muted">${earned.size} of ${STAMPS.length} collected</p>
      <div class="wl-stamp-grid">${cards}</div>
    </div>`;
}

// ---- You screen ----

export interface YouData {
  streetsMet: number;
  litLenM: number;
  walks: number;
  streak: number;
  bestStreak: number;
  week: DayBar[];
  nudges: Nudge[] | null;
  storageKind: string;
}

export function renderYou(el: HTMLElement, d: YouData): void {
  const max = Math.max(1, ...d.week.map((b) => b.distanceM));
  const bars = d.week
    .map(
      (b) => `
      <div class="wl-bar ${b.isToday ? 'is-today' : ''}">
        <div class="wl-bar-track"><i style="height:${Math.round((b.distanceM / max) * 100)}%"></i></div>
        <span>${b.label}</span>
      </div>`,
    )
    .join('');
  const weekTotal = d.week.reduce((s, b) => s + b.distanceM, 0);
  const nudges =
    d.nudges === null
      ? '<p class="wl-muted">Start a walk to find streets near you.</p>'
      : d.nudges.length
        ? `<ul class="wl-nudges">${d.nudges.map((n) => `<li><span>${esc(n.name)}</span><b>${formatDistance(n.distM)}</b></li>`).join('')}</ul>`
        : '<p class="wl-muted">Every named street nearby is lit. Time to roam further!</p>';
  el.innerHTML = `
    <div class="wl-screen-inner">
      <h1>You</h1>
      <div class="wl-you-grid">
        <div><b>${d.streetsMet}</b><span>streets met</span></div>
        <div><b>${(d.litLenM / 1000).toFixed(1)}</b><span>km of streets lit</span></div>
        <div><b>${d.walks}</b><span>walks</span></div>
        <div><b>${d.streak}</b><span>day streak${d.bestStreak > d.streak ? ` · best ${d.bestStreak}` : ''}</span></div>
      </div>
      <h3>This week <span class="wl-muted">· ${formatDistance(weekTotal)}</span></h3>
      <div class="wl-bars">${bars}</div>
      <h3>Still in the dark nearby</h3>
      ${nudges}
      <p class="wl-foot">Everything stays on this phone. No account, no server.${d.storageKind === 'memory' ? ' (Storage is unavailable here, so progress resets on reload.)' : ''}</p>
    </div>`;
}
