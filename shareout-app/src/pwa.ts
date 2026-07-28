import type { Env, PWAConfig } from './types';
import { colors } from './design-system/tokens';

interface PWAManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  theme_color: string;
  background_color: string;
  icons: Array<{
    src: string;
    sizes: string;
    type: string;
    purpose?: string;
  }>;
  screenshots: Array<{
    src: string;
    sizes: string;
    type: string;
    form_factor?: 'narrow' | 'wide';
    label?: string;
  }>;
}

export async function handleManifest(
  env: Env,
  slug: string
): Promise<Response> {
  // Fetch artifact PWA config
  const result = await env.DB.prepare(`
    SELECT pres_a.pwa_config, a.name
    FROM deployments d
    JOIN artifacts a ON a.id = d.artifact_id
    LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
    WHERE d.slug = ? AND d.channel = 'production'
  `).bind(slug).first<{ pwa_config: string | null; name: string }>();

  if (!result || !result.pwa_config) {
    return new Response('Not Found', { status: 404 });
  }

  let pwaConfig: PWAConfig;
  try {
    pwaConfig = JSON.parse(result.pwa_config);
  } catch {
    return new Response('Invalid PWA config', { status: 500 });
  }

  if (!pwaConfig.enabled) {
    return new Response('PWA not enabled', { status: 404 });
  }

  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  const artifactUrl = `${baseUrl}/a/${slug}/`;

  const startUrl = pwaConfig.start_url || artifactUrl;
  const manifest: PWAManifest = {
    id: startUrl,
    name: pwaConfig.name || result.name,
    short_name: pwaConfig.short_name || result.name.substring(0, 12),
    description: pwaConfig.description || `${pwaConfig.name || result.name} - A ShareOut PWA`,
    start_url: startUrl,
    scope: artifactUrl,
    display: pwaConfig.display || 'standalone',
    orientation: pwaConfig.orientation || 'any',
    theme_color: pwaConfig.theme_color || colors.primary,
    background_color: pwaConfig.background_color || colors.bgElevated,
    icons: generateIconList(baseUrl, slug),
    screenshots: generateScreenshots(baseUrl, slug, pwaConfig.theme_color || colors.primary),
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function generateIconList(baseUrl: string, slug: string): PWAManifest['icons'] {
  const sizes = [512, 384, 192, 152, 144, 128, 96, 72];
  const iconBase = `${baseUrl}/a/${slug}/_pwa/icon`;

  const icons: PWAManifest['icons'] = [];

  // Add icons with purpose "any" (standard icons)
  for (const size of sizes) {
    icons.push({
      src: `${iconBase}-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any',
    });
  }

  // Add 512 and 192 as maskable (for Android adaptive icons)
  icons.push({
    src: `${iconBase}-512.png`,
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  });
  icons.push({
    src: `${iconBase}-192.png`,
    sizes: '192x192',
    type: 'image/png',
    purpose: 'maskable',
  });

  return icons;
}

function generateScreenshots(baseUrl: string, slug: string, themeColor: string): PWAManifest['screenshots'] {
  return [
    {
      src: `${baseUrl}/a/${slug}/_pwa/screenshot-mobile.png`,
      sizes: '390x844',
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Mobile view',
    },
    {
      src: `${baseUrl}/a/${slug}/_pwa/screenshot-desktop.png`,
      sizes: '1280x720',
      type: 'image/png',
      form_factor: 'wide',
      label: 'Desktop view',
    },
  ];
}

export async function handleServiceWorker(
  env: Env,
  slug: string
): Promise<Response> {
  // Fetch artifact PWA config
  const result = await env.DB.prepare(`
    SELECT pres_a.pwa_config
    FROM deployments d
    JOIN artifacts a ON a.id = d.artifact_id
    LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
    WHERE d.slug = ? AND d.channel = 'production'
  `).bind(slug).first<{ pwa_config: string | null }>();

  if (!result || !result.pwa_config) {
    return new Response('Not Found', { status: 404 });
  }

  let pwaConfig: PWAConfig;
  try {
    pwaConfig = JSON.parse(result.pwa_config);
  } catch {
    return new Response('Invalid PWA config', { status: 500 });
  }

  if (!pwaConfig.enabled) {
    return new Response('PWA not enabled', { status: 404 });
  }

  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  const cacheName = pwaConfig.offline?.cacheName || `shareout-${slug}-v1`;
  const strategy = pwaConfig.offline?.strategy || 'cache-first';
  const additionalAssets = pwaConfig.offline?.assets || [];

  const swCode = generateServiceWorker({
    cacheName,
    strategy,
    baseUrl,
    slug,
    additionalAssets,
  });

  return new Response(swCode, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}

interface SWParams {
  cacheName: string;
  strategy: 'cache-first' | 'network-first';
  baseUrl: string;
  slug: string;
  additionalAssets: string[];
}

function generateServiceWorker(params: SWParams): string {
  const { cacheName, strategy, baseUrl, slug, additionalAssets } = params;
  const artifactUrl = `${baseUrl}/a/${slug}/`;

  const coreAssets = [
    artifactUrl,
    `${artifactUrl}manifest.json`,
    ...additionalAssets.map(a => a.startsWith('/') ? `${artifactUrl}${a.slice(1)}` : a),
  ];

  const strategyCode = strategy === 'cache-first'
    ? `
    // Cache-first strategy
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          // Return cached, but also fetch and update cache in background
          fetch(event.request).then(response => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, response);
              });
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        });
      })
    );`
    : `
    // Network-first strategy
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );`;

  return `// ShareOut PWA Service Worker
// Generated for: ${slug}

const CACHE_NAME = '${cacheName}';
const CORE_ASSETS = ${JSON.stringify(coreAssets, null, 2)};

// Install: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key.startsWith('shareout-${slug}-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: serve from cache or network
self.addEventListener('fetch', event => {
  // Only handle same-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
${strategyCode}
});

// Handle messages from the app
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
`;
}

export async function handlePWAIcon(
  env: Env,
  slug: string,
  size: number
): Promise<Response> {
  // For now, we'll serve a placeholder or the original icon resized
  // In production, you'd want to pre-generate these or use a image processing service

  // Fetch the original icon from PWA config
  const result = await env.DB.prepare(`
    SELECT pres_a.pwa_config
    FROM deployments d
    JOIN artifacts a ON a.id = d.artifact_id
    LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
    WHERE d.slug = ? AND d.channel = 'production'
  `).bind(slug).first<{ pwa_config: string | null }>();

  if (!result || !result.pwa_config) {
    return new Response('Not Found', { status: 404 });
  }

  let pwaConfig: PWAConfig;
  try {
    pwaConfig = JSON.parse(result.pwa_config);
  } catch {
    return new Response('Invalid PWA config', { status: 500 });
  }

  if (!pwaConfig.enabled || !pwaConfig.icon) {
    return new Response('Icon not available', { status: 404 });
  }

  // Decode base64 icon
  // For simplicity, we return the original icon for all sizes
  // In production, you'd resize using Workers Image Resizing or pre-generate
  try {
    const iconData = pwaConfig.icon.replace(/^data:image\/\w+;base64,/, '');
    const iconBuffer = Uint8Array.from(atob(iconData), c => c.charCodeAt(0));

    return new Response(iconBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Invalid icon data', { status: 500 });
  }
}

export async function handlePWAScreenshot(
  env: Env,
  slug: string,
  type: 'mobile' | 'desktop'
): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT pres_a.pwa_config, a.name
    FROM deployments d
    JOIN artifacts a ON a.id = d.artifact_id
    LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
    WHERE d.slug = ? AND d.channel = 'production'
  `).bind(slug).first<{ pwa_config: string | null; name: string }>();

  if (!result || !result.pwa_config) {
    return new Response('Not Found', { status: 404 });
  }

  let pwaConfig: PWAConfig;
  try {
    pwaConfig = JSON.parse(result.pwa_config);
  } catch {
    return new Response('Invalid PWA config', { status: 500 });
  }

  if (!pwaConfig.enabled) {
    return new Response('PWA not enabled', { status: 404 });
  }

  const width = type === 'mobile' ? 390 : 1280;
  const height = type === 'mobile' ? 844 : 720;
  const themeColor = pwaConfig.theme_color || colors.primary;
  const bgColor = pwaConfig.background_color || colors.bgElevated;
  const appName = pwaConfig.name || result.name;

  const png = generatePlaceholderScreenshot(width, height, themeColor, bgColor, appName);

  return new Response(png, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

function generatePlaceholderScreenshot(
  width: number,
  height: number,
  themeColor: string,
  bgColor: string,
  appName: string
): Uint8Array {
  const rgb = hexToRgb(themeColor);
  const bgRgb = hexToRgb(bgColor);

  const pixels = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const headerHeight = Math.floor(height * 0.08);

      if (y < headerHeight) {
        pixels[idx] = rgb.r;
        pixels[idx + 1] = rgb.g;
        pixels[idx + 2] = rgb.b;
      } else {
        pixels[idx] = bgRgb.r;
        pixels[idx + 1] = bgRgb.g;
        pixels[idx + 2] = bgRgb.b;
      }
      pixels[idx + 3] = 255;
    }
  }

  return createMinimalPNG(width, height, pixels);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 59, g: 130, b: 246 };
}

function createMinimalPNG(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = createIHDRChunk(width, height);
  const idat = createIDATChunk(width, height, pixels);
  const iend = createIENDChunk();

  const result = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let offset = 0;
  result.set(signature, offset); offset += signature.length;
  result.set(ihdr, offset); offset += ihdr.length;
  result.set(idat, offset); offset += idat.length;
  result.set(iend, offset);

  return result;
}

function createIHDRChunk(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = 8;
  data[9] = 2;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return createChunk('IHDR', data);
}

function createIDATChunk(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const rowSize = 1 + width * 3;
  const rawData = new Uint8Array(height * rowSize);

  for (let y = 0; y < height; y++) {
    rawData[y * rowSize] = 0;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * rowSize + 1 + x * 3;
      rawData[dstIdx] = pixels[srcIdx];
      rawData[dstIdx + 1] = pixels[srcIdx + 1];
      rawData[dstIdx + 2] = pixels[srcIdx + 2];
    }
  }

  const compressed = deflateRaw(rawData);
  return createChunk('IDAT', compressed);
}

function createIENDChunk(): Uint8Array {
  return createChunk('IEND', new Uint8Array(0));
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);

  view.setUint32(0, data.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  const crcData = new Uint8Array(4 + data.length);
  crcData.set(typeBytes, 0);
  crcData.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcData), false);

  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function deflateRaw(data: Uint8Array): Uint8Array {
  const maxBlockSize = 65535;
  const blocks: Uint8Array[] = [];
  let offset = 0;

  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockSize = Math.min(remaining, maxBlockSize);
    const isLast = offset + blockSize >= data.length;

    const block = new Uint8Array(5 + blockSize);
    block[0] = isLast ? 0x01 : 0x00;
    block[1] = blockSize & 0xff;
    block[2] = (blockSize >> 8) & 0xff;
    block[3] = (~blockSize) & 0xff;
    block[4] = ((~blockSize) >> 8) & 0xff;
    block.set(data.subarray(offset, offset + blockSize), 5);

    blocks.push(block);
    offset += blockSize;
  }

  let totalLength = 2 + 4;
  for (const block of blocks) totalLength += block.length;

  const result = new Uint8Array(totalLength);
  result[0] = 0x78;
  result[1] = 0x01;

  let pos = 2;
  for (const block of blocks) {
    result.set(block, pos);
    pos += block.length;
  }

  const adler = adler32(data);
  const view = new DataView(result.buffer);
  view.setUint32(pos, adler, false);

  return result;
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}
