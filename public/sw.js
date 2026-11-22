// The browser version kept itself in a service worker until it became the demo (ADR 0013). This
// file takes that worker's place for anyone who still has it: it deletes the old caches, removes
// itself, and reloads the open pages from the network. No page registers it.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((pages) => pages.forEach((p) => p.navigate(p.url))),
  );
});
