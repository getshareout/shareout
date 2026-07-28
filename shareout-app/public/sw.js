/* App-shell service worker — network-first with a tiny offline fallback.
 * Skips non-GET, artifact pages (/a/), and API/SSE (/v1/) so per-artifact SWs win. */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const path = new URL(req.url).pathname;
  if (path.startsWith('/a/') || path.startsWith('/v1/')) return;
  event.respondWith(
    fetch(req).catch(() => new Response('Offline — open ShareOut when you\'re back online.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }))
  );
});
