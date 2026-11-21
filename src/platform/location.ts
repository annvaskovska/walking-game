import type { Fix } from '../core/types';

export type LocationErrorKind = 'denied' | 'unavailable' | 'timeout';

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
 * Where positions come from: the iPhone app's GPS (nativeLocation.ts), which keeps recording with
 * the screen locked, or the demo walk (simLocation.ts), which every browser runs (ADR 0013).
 */
export interface LocationProvider {
  readonly kind: 'device' | 'sim';
  /** Clock that matches fix timestamps (the simulator runs its own, possibly faster, clock). */
  now(): number;
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
