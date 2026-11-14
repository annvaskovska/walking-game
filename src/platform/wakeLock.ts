/**
 * Keeps the screen on during a walk (a web app only gets GPS while it is open and visible).
 * The browser drops the lock whenever the page is hidden, so it is re-acquired on return.
 */
export type WakeState = 'off' | 'on' | 'unsupported' | 'failed';

export class WakeLockKeeper {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  state: WakeState = 'off';

  constructor(private onChange: (s: WakeState) => void = () => {}) {
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') void this.acquire();
    });
  }

  get supported(): boolean {
    return 'wakeLock' in navigator;
  }

  async enable(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    try {
      await s?.release();
    } catch {
      /* already released */
    }
    this.set('off');
  }

  private async acquire(): Promise<void> {
    if (!this.supported) return this.set('unsupported');
    if (this.sentinel && !this.sentinel.released) return this.set('on');
    if (document.visibilityState !== 'visible') return;
    try {
      const s = await navigator.wakeLock.request('screen');
      if (!this.wanted) {
        await s.release();
        return;
      }
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
        if (this.wanted) this.set(document.visibilityState === 'visible' ? 'failed' : 'off');
      });
      this.set('on');
    } catch {
      this.set('failed');
    }
  }

  private set(s: WakeState) {
    if (this.state === s) return;
    this.state = s;
    this.onChange(s);
  }
}
