import { registerSW } from 'virtual:pwa-register';
import { startApp } from './app/app';
import { isNativeApp } from './platform/native';

startApp().catch((err: unknown) => {
  console.error(err);
  const el = document.createElement('div');
  el.className = 'wl-fatal';
  el.innerHTML = '<h2>Wanderlight couldn’t start</h2><p></p><button type="button">Try again</button>';
  el.querySelector('p')!.textContent = String((err as Error)?.message ?? err);
  el.querySelector('button')!.addEventListener('click', () => location.reload());
  document.body.append(el);
});

/**
 * The service worker makes the next start instant and lets a walk go on offline. It registers a
 * few seconds after the page has loaded, so its downloads never compete with the first map
 * tiles. A new version takes over only while no walk is on: right away if Start hasn't been
 * tapped yet, otherwise the next time the page is in the background between walks.
 */
const walking = () =>
  document.documentElement.classList.contains('wl-walking') || !!(window as { __wl?: { tapped?: number } }).__wl?.tapped;

function register(): void {
  window.setTimeout(() => {
    const update = registerSW({
      onNeedRefresh() {
        const apply = () => {
          if (walking()) return false;
          void update(true);
          return true;
        };
        if (apply()) return;
        document.addEventListener('visibilitychange', function retry() {
          if (document.visibilityState === 'hidden' && !document.documentElement.classList.contains('wl-walking')) {
            document.removeEventListener('visibilitychange', retry);
            void update(true);
          }
        });
      },
    });
  }, 3000);
}
// The iPhone app carries its files inside it, so it needs no service worker to keep them.
if (!isNativeApp()) {
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
