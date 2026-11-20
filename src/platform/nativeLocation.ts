import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Fix } from '../core/types';
import type { LocationErrorKind, LocationProvider, PermissionStatus } from './location';

/**
 * Location in the iPhone app, from the phone's GPS through the native WalkTracker plugin
 * (ios/App/App/WalkTrackerPlugin.swift). A walk goes on with the screen locked: the native side
 * keeps every fix of the walk, numbered, on disk. While the web view runs it gets each fix as an
 * event; when it has missed some (iOS paused it while the screen was locked, or reloaded it), it
 * reads them back from where it left off, in order, so the walk is the same as if it had seen them
 * live.
 */

/** [lon, lat, accuracy m, time ms, speed m/s | null, course ° | null] */
export type RawFix = [number, number, number, number, number | null, number | null];

export interface WalkTrackerPlugin {
  /** Records the walk `walk`, carrying on with its fixes if they are already kept (a reload). */
  start(o: { walk: string }): Promise<{ resumed: boolean }>;
  /** Ends the walk and forgets its fixes. */
  stop(): Promise<void>;
  /** Fixes numbered `from` on, taken after `after`; `next` is the number the next fix will get. */
  fixes(o: { from: number; after?: number }): Promise<{ next: number; fixes: RawFix[] }>;
  lastFixTime(o: { walk: string }): Promise<{ t: number | null }>;
  current(): Promise<{ fix: RawFix }>;
  permission(): Promise<{ location: 'granted' | 'denied' | 'prompt' }>;
  addListener(event: 'fix', fn: (e: { seq: number; fix: RawFix }) => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'error',
    fn: (e: { kind: Extract<LocationErrorKind, 'denied' | 'unavailable' | 'timeout'>; message: string }) => void,
  ): Promise<PluginListenerHandle>;
}

/** Without a fix for this long, say so (as watchPosition's timeout does in the browser). */
export const SILENCE_MS = 30_000;

export function toFix(r: RawFix): Fix {
  return { lon: r[0], lat: r[1], acc: r[2], t: r[3], speed: r[4] ?? null, heading: r[5] ?? null };
}

/** Calls `fn` each time the app comes back to the screen; returns a function that stops. */
function onVisible(fn: () => void): () => void {
  const h = () => {
    if (document.visibilityState === 'visible') fn();
  };
  document.addEventListener('visibilitychange', h);
  return () => document.removeEventListener('visibilitychange', h);
}

export function createNativeLocation(
  plugin: WalkTrackerPlugin = registerPlugin<WalkTrackerPlugin>('WalkTracker'),
  resumed: (fn: () => void) => () => void = onVisible,
): LocationProvider {
  return {
    kind: 'device',
    now: () => Date.now(),
    unavailable: () => null,

    watch(onFix, onError, opts = {}) {
      const walk = opts.walk ?? `w${Date.now().toString(36)}`;
      /** Time of the last fix handed on: older ones were seen already. */
      let since = opts.since ?? -Infinity;
      /** Number of the next fix expected from the native side. */
      let next = 0;
      let stopped = false;
      let started = false;
      let pulling = false;
      let again = false;
      let heardAt = Date.now();
      let silent = false;

      const deliver = (raw: RawFix): boolean => {
        const fix = toFix(raw);
        if (!(fix.t > since)) return false;
        since = fix.t;
        heardAt = Date.now();
        silent = false;
        onFix(fix);
        return true;
      };

      /** Reads back every fix from `next` on. One read at a time; asked again meanwhile, it reads again. */
      const pull = async (): Promise<void> => {
        if (pulling) {
          again = true;
          return;
        }
        pulling = true;
        try {
          do {
            again = false;
            const r = await plugin.fixes({ from: next, after: Number.isFinite(since) ? since : undefined });
            if (stopped) return;
            next = Math.max(next, r.next);
            let n = 0;
            for (const raw of r.fixes) if (deliver(raw)) n++;
            if (n > 1) opts.onCatchUp?.(n);
          } while (again && !stopped);
        } catch (e) {
          console.warn('Wanderlight: could not read back the walk', e);
        } finally {
          pulling = false;
        }
      };

      const listeners = [
        plugin.addListener('fix', ({ seq, fix }) => {
          if (stopped || !started) return;
          if (seq === next && !pulling) {
            next++;
            deliver(fix);
          } else if (seq >= next) {
            // Some went missing in between (or a read is on): read them all back, in order.
            void pull();
          }
        }),
        plugin.addListener('error', ({ kind, message }) => {
          if (!stopped) onError({ kind, message });
        }),
      ];

      void (async () => {
        try {
          // Listen first, so a refusal while starting is heard.
          await Promise.all(listeners);
          if (stopped) return;
          await plugin.start({ walk });
          if (stopped) return;
          started = true;
          // What was kept before this page was here (the app reloaded mid-walk).
          await pull();
        } catch (e) {
          if (!stopped) onError({ kind: 'unavailable', message: String((e as Error)?.message ?? e) });
        }
      })();

      const offResume = resumed(() => {
        if (stopped || !started) return;
        // Back from the lock screen: catch up before calling the GPS silent.
        heardAt = Date.now();
        void pull();
      });

      const watchdog = setInterval(() => {
        if (stopped || silent || Date.now() - heardAt < SILENCE_MS) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        silent = true;
        onError({ kind: 'timeout', message: 'No position for a while' });
      }, 5000);

      return () => {
        if (stopped) return;
        stopped = true;
        clearInterval(watchdog);
        offResume();
        for (const l of listeners) void l.then((h) => h.remove()).catch(() => {});
        void plugin.stop().catch(() => {});
      };
    },

    async lastFixTime(walk) {
      try {
        return (await plugin.lastFixTime({ walk })).t;
      } catch {
        return null;
      }
    },

    async current() {
      try {
        return toFix((await plugin.current()).fix);
      } catch (e) {
        throw { kind: 'unavailable', message: String((e as Error)?.message ?? e) };
      }
    },

    async permission(): Promise<PermissionStatus> {
      try {
        return (await plugin.permission()).location;
      } catch {
        return 'prompt';
      }
    },
  };
}
