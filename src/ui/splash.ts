const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const html = document.documentElement;
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

export interface Lifetime {
  streets: number;
  km: string;
}

/**
 * The cover: the start screen, a coloring book's yellow cover with Start (ADR 0014). Its markup and
 * art live in index.html so they paint before any script loads; this drives it once the app is up.
 * Hiding it turns it like a book page onto the map drawn under it; showing it turns it back.
 */
export class Splash {
  private go = byId<HTMLButtonElement>('wl-go');
  private msg = byId('wl-msg');
  private stats = byId('wl-stats');
  private page = byId('wl-page');

  onStart(fn: () => void): void {
    this.go.addEventListener('click', fn);
  }

  get visible(): boolean {
    return !html.classList.contains('wl-walking');
  }

  show(): void {
    const back = !this.visible;
    html.classList.remove('wl-walking');
    themeColor?.setAttribute('content', '#ffd23f');
    this.busy(false);
    // Turned back from a walk: focus goes to Start, as a new screen's does.
    if (back) this.go.focus({ preventScroll: true });
  }

  hide(): void {
    html.classList.add('wl-walking');
    themeColor?.setAttribute('content', '#fffefb');
    // The page turns with Start's label on it, as it was tapped.
    this.busy(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
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

  /** Back to the cover from its first line, before show(). */
  intro(): void {
    this.page.scrollTop = 0;
  }
}
