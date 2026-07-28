/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_VERSION = 'shareout-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const STATIC_PATTERNS = [
  /\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|avif|ico|wasm)$/i,
];

const DATA_PATTERNS = [
  /\/v1\/data\/[^/]+\/json\//,
  /\/v1\/data\/[^/]+\/tables\//,
  /\/v1\/data\/[^/]+\/datasets\//,
];

const MAX_CACHE_SIZE = 100;
const DATA_MAX_AGE = 5 * 60 * 1000;

interface CacheEntry {
  response: Response;
  timestamp: number;
}

sw.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE),
      caches.open(DATA_CACHE),
    ]).then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('shareout-') && key !== STATIC_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.origin !== sw.location.origin) return;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isDataRequest(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  if (url.pathname.startsWith('/a/')) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }
});

function isStaticAsset(pathname: string): boolean {
  return STATIC_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isDataRequest(pathname: string): boolean {
  return DATA_PATTERNS.some((pattern) => pattern.test(pathname));
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await trimCache(cache, MAX_CACHE_SIZE);
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(async (response) => {
    if (response.ok) {
      const clone = response.clone();
      await cache.put(request, clone);
      await trimCache(cache, MAX_CACHE_SIZE);
    }
    return response;
  }).catch(() => null);

  if (cached) {
    const cachedDate = cached.headers.get('date');
    if (cachedDate) {
      const age = Date.now() - new Date(cachedDate).getTime();
      if (age > DATA_MAX_AGE) {
        const fresh = await fetchPromise;
        if (fresh) return fresh;
      }
    }
    return cached;
  }

  const networkResponse = await fetchPromise;
  if (networkResponse) {
    return networkResponse;
  }

  return new Response(JSON.stringify({ success: false, error: 'Offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function trimCache(cache: Cache, maxSize: number): Promise<void> {
  const keys = await cache.keys();
  if (keys.length > maxSize) {
    const toDelete = keys.slice(0, keys.length - maxSize);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    sw.skipWaiting();
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => {
        return Promise.all(keys.map((key) => caches.delete(key)));
      })
    );
  }

  if (event.data?.type === 'PRECACHE' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(STATIC_CACHE).then((cache) => {
        return Promise.allSettled(
          event.data.urls.map((url: string) =>
            fetch(url).then((response) => {
              if (response.ok) {
                return cache.put(url, response);
              }
            })
          )
        );
      })
    );
  }
});

export {};
