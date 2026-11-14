import { esc, ICONS, refs } from './dom';

export type Tab = 'map' | 'stamps' | 'you';

const REF_NAMES = ['map', 'badge', 'banners', 'toasts', 'mapUi', 'recenter', 'dock', 'stamps', 'you', 'sheet', 'tabs'] as const;
export type ShellRefs = Record<(typeof REF_NAMES)[number], HTMLElement>;

/** Static app skeleton: map, overlays, screens and the bottom tab bar. */
export function buildShell(root: HTMLElement): ShellRefs {
  root.innerHTML = `
    <div class="wl-map" data-ref="map"></div>
    <header class="wl-top">
      <div class="wl-brand"><span class="wl-brand-dot"></span>Wanderlight</div>
      <span class="wl-badge" data-ref="badge" hidden></span>
    </header>
    <div class="wl-banners" data-ref="banners" aria-live="polite"></div>
    <div class="wl-toasts" data-ref="toasts" aria-live="polite"></div>
    <div class="wl-map-ui" data-ref="mapUi">
      <button class="wl-fab" data-ref="recenter" aria-label="Show where I am">${ICONS.locate}</button>
      <div class="wl-dock" data-ref="dock"></div>
    </div>
    <section class="wl-screen" data-ref="stamps" hidden></section>
    <section class="wl-screen" data-ref="you" hidden></section>
    <div class="wl-sheet-wrap" data-ref="sheet" hidden></div>
    <nav class="wl-tabs" data-ref="tabs">
      ${tabButton('map', 'Map', ICONS.map)}
      ${tabButton('stamps', 'Stamps', ICONS.stamp)}
      ${tabButton('you', 'You', ICONS.you)}
    </nav>`;
  return refs(root, REF_NAMES);
}

function tabButton(tab: Tab, label: string, icon: string): string {
  return `<button class="wl-tab" data-tab="${tab}" aria-label="${esc(label)}">${icon}<span>${esc(label)}</span></button>`;
}

export function selectTab(r: ShellRefs, tab: Tab): void {
  r.tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  r.stamps.hidden = tab !== 'stamps';
  r.you.hidden = tab !== 'you';
  r.mapUi.hidden = tab !== 'map';
}

// ---- Toasts ----

export function toast(r: ShellRefs, text: string, kind: 'street' | 'stamp' | 'info' = 'info', icon = ''): void {
  const el = document.createElement('div');
  el.className = `wl-toast is-${kind}`;
  el.innerHTML = `${icon ? `<span class="wl-toast-icon">${esc(icon)}</span>` : ''}<span>${esc(text)}</span>`;
  r.toasts.prepend(el);
  while (r.toasts.children.length > 3) r.toasts.lastElementChild?.remove();
  setTimeout(() => el.classList.add('is-leaving'), 3200);
  setTimeout(() => el.remove(), 3700);
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
