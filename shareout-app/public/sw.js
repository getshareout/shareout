/* App-shell service worker — network-first with a tiny offline fallback.
 * Handles page navigations only: subresources (scripts, styles, images) go straight
 * to the network and HTTP cache, and artifact pages (/a/) and API/SSE (/v1/) are never
 * touched so per-artifact SWs win. Navigation preload starts the page request while the
 * worker boots, so the SW adds no startup delay to the navigation. */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const path = new URL(req.url).pathname;
  if (path.startsWith('/a/') || path.startsWith('/v1/')) return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(req);
    } catch (e) {
      return new Response('Offline — open ShareOut when you\'re back online.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
