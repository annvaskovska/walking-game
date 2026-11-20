import type { Fix } from '../core/types';

export type LocationErrorKind = 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'insecure';

export interface LocationError {
  kind: LocationErrorKind;
  message: string;
}

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface WatchOptions {
  /** The walk being recorded. The iPhone app keeps its fixes under this id across reloads. */
  walk?: string;
  /** Fixes taken at or before this time (ms) were already handled: a reload mid-walk carries on after it. */
  since?: number;
  /**
   * Several fixes arrived at once, recorded while the app couldn't run (the screen was locked):
   * time to put the walker where you are now instead of sliding it there.
   */
  onCatchUp?: (count: number) => void;
}

/**
 * Where positions come from. The browser implementation wraps navigator.geolocation; the iPhone
 * app's (nativeLocation.ts) keeps recording with the screen locked; the simulator stands in for
 * desktop tests.
 */
export interface LocationProvider {
  readonly kind: 'device' | 'sim';
  /** Clock that matches fix timestamps (the simulator runs its own, possibly faster, clock). */
  now(): number;
  /** Why location can't work here at all (no https, no geolocation), or null. */
  unavailable?(): LocationError | null;
  /**
   * Start watching; returns a function that stops. Stopping ends the walk: the iPhone app forgets
   * the fixes it kept for it.
   */
  watch(onFix: (f: Fix) => void, onError: (e: LocationError) => void, opts?: WatchOptions): () => void;
  /** When the provider's own record of this walk last got a fix (ms), if it keeps one. */
  lastFixTime?(walk: string): Promise<number | null>;
  /** One position, e.g. to centre the map before a walk. */
  current(timeoutMs?: number): Promise<Fix>;
  permission(): Promise<PermissionStatus>;
  /** Called when a walk ends (the simulator rewinds its route). */
  reset?(): void;
  /** Short label for a debug badge; only the simulator has one. */
  readonly badge?: string;
}

function toFix(p: GeolocationPosition): Fix {
  const c = p.coords;
  return {
    lon: c.longitude,
    lat: c.latitude,
    acc: c.accuracy,
    t: p.timestamp || Date.now(),
    speed: c.speed,
    heading: c.heading,
  };
}

function toError(e: GeolocationPositionError): LocationError {
  switch (e.code) {
    case e.PERMISSION_DENIED:
      return { kind: 'denied', message: e.message };
    case e.POSITION_UNAVAILABLE:
      return { kind: 'unavailable', message: e.message };
    default:
      return { kind: 'timeout', message: e.message };
  }
}

function precheck(): LocationError | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return { kind: 'insecure', message: 'Location needs a secure (https) connection.' };
  }
  if (!('geolocation' in navigator)) {
    return { kind: 'unsupported', message: 'This browser has no location support.' };
  }
  return null;
}

export function createBrowserLocation(): LocationProvider {
  return {
    kind: 'device',
    now: () => Date.now(),
    unavailable: precheck,
    watch(onFix, onError) {
      const pre = precheck();
      if (pre) {
        queueMicrotask(() => onError(pre));
        return () => {};
      }
      const id = navigator.geolocation.watchPosition(
        (p) => onFix(toFix(p)),
        (e) => onError(toError(e)),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    },
    current(timeoutMs = 15_000) {
      const pre = precheck();
      if (pre) return Promise.reject(pre);
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve(toFix(p)),
          (e) => reject(toError(e)),
          { enableHighAccuracy: true, maximumAge: 60_000, timeout: timeoutMs },
        );
      });
    },
    async permission() {
      if (precheck()) return 'unsupported';
      try {
        const s = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
        return (s?.state as PermissionStatus) ?? 'prompt';
      } catch {
        return 'prompt';
      }
    },
  };
}
