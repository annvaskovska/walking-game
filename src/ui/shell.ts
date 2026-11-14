import { esc, ICONS, refs } from './dom';

const REF_NAMES = ['map', 'badge', 'banners', 'mapUi', 'recenter', 'dock', 'sheet'] as const;
export type ShellRefs = Record<(typeof REF_NAMES)[number], HTMLElement>;

/** Static app skeleton: the map, its overlays and the walk dock. One screen, no tabs. */
export function buildShell(root: HTMLElement): ShellRefs {
  root.innerHTML = `
    <div class="wl-map" data-ref="map"></div>
    <header class="wl-top">
      <div class="wl-brand"><span class="wl-brand-dot"></span>Wanderlight</div>
      <span class="wl-badge" data-ref="badge" hidden></span>
    </header>
    <div class="wl-banners" data-ref="banners" aria-live="polite"></div>
    <div class="wl-map-ui" data-ref="mapUi">
      <button class="wl-fab" data-ref="recenter" aria-label="Show where I am">${ICONS.locate}</button>
      <div class="wl-dock" data-ref="dock"></div>
    </div>
    <div class="wl-sheet-wrap" data-ref="sheet" hidden></div>`;
  return refs(root, REF_NAMES);
}

// ---- Banners (persistent states: GPS, network, wake lock) ----

export interface Banner {
  kind: 'info' | 'warn' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}

const banners = new Map<string, Banner>();

export function setBanner(r: ShellRefs, id: string, b: Banner | null): void {
  const prev = banners.get(id);
  if (!b && !prev) return;
  if (b && prev && prev.text === b.text && prev.kind === b.kind && !!prev.action === !!b.action) return;
  if (b) banners.set(id, b);
  else banners.delete(id);
  r.banners.innerHTML = '';
  for (const [bid, ban] of banners) {
    const el = document.createElement('div');
    el.className = `wl-banner is-${ban.kind}`;
    el.dataset.id = bid;
    el.innerHTML = `<span>${esc(ban.text)}</span>`;
    if (ban.action) {
      const btn = document.createElement('button');
      btn.textContent = ban.action.label;
      btn.addEventListener('click', ban.action.run);
      el.append(btn);
    }
    r.banners.append(el);
  }
}

// ---- Bottom sheet ----

export function openSheet(r: ShellRefs, html: string, onClose?: () => void): HTMLElement {
  r.sheet.innerHTML = `<div class="wl-sheet" role="dialog" aria-modal="true">${html}</div>`;
  r.sheet.hidden = false;
  const close = () => {
    r.sheet.hidden = true;
    r.sheet.innerHTML = '';
    onClose?.();
  };
  r.sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  return r.sheet.firstElementChild as HTMLElement;
}
