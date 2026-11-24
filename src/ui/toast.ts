const el = () => document.getElementById('wl-toast') as HTMLElement;

/**
 * One line at the top of the map, only when something is wrong (no GPS, no network) or worth a
 * word, on a hand-drawn card (walk.css, which hud.ts injects). Each message has a key, so clearing
 * one never hides another that replaced it.
 */
export class Toasts {
  private key: string | null = null;
  private timer = 0;

  /** `ms` 0 keeps it up until it is cleared. */
  show(key: string, text: string, kind: 'info' | 'warn' = 'info', ms = 0): void {
    const t = el();
    this.key = key;
    t.textContent = text;
    t.dataset.kind = kind;
    t.hidden = false;
    clearTimeout(this.timer);
    if (ms > 0) this.timer = window.setTimeout(() => this.clear(key), ms);
  }

  clear(key?: string): void {
    if (key !== undefined && key !== this.key) return;
    clearTimeout(this.timer);
    this.key = null;
    el().hidden = true;
  }

  get current(): string | null {
    return this.key;
  }
}
