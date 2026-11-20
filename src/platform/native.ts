/**
 * Is this the iPhone app (the web app inside the Capacitor shell in ios/) rather than a browser?
 * Capacitor puts `window.Capacitor` on the page before any script runs, so this works before
 * `@capacitor/core` has loaded, and the web build never has to load it.
 */
export function isNativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}
