import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleManifest,
  handlePWAIcon,
  handlePWAScreenshot,
  handleServiceWorker,
} from '../../src/pwa';
import type { Env, PWAConfig } from '../../src/types';

const BASE_URL = 'https://shareout.example.com';
const SLUG = 'demo-pwa';

const MINIMAL_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makePwaConfig(overrides: Partial<PWAConfig> = {}): PWAConfig {
  return {
    enabled: true,
    name: 'Demo PWA',
    short_name: 'Demo',
    icon: MINIMAL_PNG_BASE64,
    ...overrides,
  };
}

function makeDbMock(
  firstResult: { pwa_config: string | null; name?: string } | null
): Env['DB'] {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => firstResult),
      })),
    })),
  } as unknown as Env['DB'];
}

function makeEnv(db: Env['DB']): Env {
  return {
    SHAREOUT_BASE_URL: BASE_URL,
    DB: db,
  } as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleManifest', () => {
  it('returns 404 when deployment not found', async () => {
    const env = makeEnv(makeDbMock(null));
    const res = await handleManifest(env, SLUG);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });

  it('returns 404 when pwa_config is null', async () => {
    const env = makeEnv(makeDbMock({ pwa_config: null, name: 'Demo' }));
    const res = await handleManifest(env, SLUG);
    expect(res.status).toBe(404);
  });

  it('returns 500 for invalid JSON config', async () => {
    const env = makeEnv(makeDbMock({ pwa_config: '{bad json', name: 'Demo' }));
    const res = await handleManifest(env, SLUG);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Invalid PWA config');
  });

  it('returns 404 when PWA is disabled', async () => {
    const config = makePwaConfig({ enabled: false });
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config), name: 'Demo' }));
    const res = await handleManifest(env, SLUG);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('PWA not enabled');
  });

  it('returns manifest with defaults', async () => {
    const config = makePwaConfig();
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config), name: 'Artifact Name' }));
    const res = await handleManifest(env, SLUG);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/manifest+json');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const manifest = JSON.parse(await res.text());
    expect(manifest.name).toBe('Demo PWA');
    expect(manifest.short_name).toBe('Demo');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('any');
    expect(manifest.theme_color).toBe('#2563eb');
    expect(manifest.background_color).toBe('#ffffff');
    expect(manifest.start_url).toBe(`${BASE_URL}/a/${SLUG}/`);
    expect(manifest.scope).toBe(`${BASE_URL}/a/${SLUG}/`);
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    expect(manifest.screenshots).toHaveLength(2);
    expect(manifest.screenshots[0].form_factor).toBe('narrow');
    expect(manifest.screenshots[1].form_factor).toBe('wide');
  });

  it('uses custom config fields and artifact name fallbacks', async () => {
    const config = makePwaConfig({
      name: '',
      short_name: '',
      description: 'Custom description',
      start_url: 'https://custom.example/start',
      display: 'fullscreen',
      orientation: 'portrait',
      theme_color: '#ff0000',
      background_color: '#000000',
    });
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config), name: 'Long Artifact Name Here' }));
    const res = await handleManifest(env, SLUG);
    const manifest = JSON.parse(await res.text());

    expect(manifest.name).toBe('Long Artifact Name Here');
    expect(manifest.short_name).toBe('Long Artifac');
    expect(manifest.description).toBe('Custom description');
    expect(manifest.start_url).toBe('https://custom.example/start');
    expect(manifest.id).toBe('https://custom.example/start');
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.theme_color).toBe('#ff0000');
    expect(manifest.background_color).toBe('#000000');
  });

  it('strips trailing slash from base URL', async () => {
    const config = makePwaConfig();
    const env = {
      SHAREOUT_BASE_URL: `${BASE_URL}/`,
      DB: makeDbMock({ pwa_config: JSON.stringify(config), name: 'Demo' }),
    } as Env;
    const res = await handleManifest(env, SLUG);
    const manifest = JSON.parse(await res.text());
    expect(manifest.scope).toBe(`${BASE_URL}/a/${SLUG}/`);
  });
});

describe('handleServiceWorker', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv(makeDbMock(null));
    const res = await handleServiceWorker(env, SLUG);
    expect(res.status).toBe(404);
  });

  it('returns 500 for invalid JSON', async () => {
    const env = makeEnv(makeDbMock({ pwa_config: 'not-json' }));
    const res = await handleServiceWorker(env, SLUG);
    expect(res.status).toBe(500);
  });

  it('returns 404 when disabled', async () => {
    const config = makePwaConfig({ enabled: false });
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config) }));
    const res = await handleServiceWorker(env, SLUG);
    expect(res.status).toBe(404);
  });

  it('generates cache-first service worker with defaults', async () => {
    const config = makePwaConfig();
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config) }));
    const res = await handleServiceWorker(env, SLUG);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/javascript');
    expect(res.headers.get('Service-Worker-Allowed')).toBe('/');

    const sw = await res.text();
    expect(sw).toContain(`shareout-${SLUG}-v1`);
    expect(sw).toContain('Cache-first strategy');
    expect(sw).toContain('self.addEventListener(\'install\'');
    expect(sw).toContain(`${BASE_URL}/a/${SLUG}/`);
    expect(sw).toContain('manifest.json');
  });

  it('generates network-first service worker with custom offline config', async () => {
    const config = makePwaConfig({
      offline: {
        cacheName: 'custom-cache',
        strategy: 'network-first',
        assets: ['/styles.css', 'https://cdn.example/lib.js'],
      },
    });
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config) }));
    const res = await handleServiceWorker(env, SLUG);
    const sw = await res.text();

    expect(sw).toContain('custom-cache');
    expect(sw).toContain('Network-first strategy');
    expect(sw).toContain('styles.css');
    expect(sw).toContain('https://cdn.example/lib.js');
  });
});

describe('handlePWAIcon', () => {
  it('returns 404 when config missing', async () => {
    const env = makeEnv(makeDbMock(null));
    const res = await handlePWAIcon(env, SLUG, 192);
    expect(res.status).toBe(404);
  });

  it('returns 404 when icon not configured', async () => {
    const config = makePwaConfig({ icon: '' });
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config) }));
    const res = await handlePWAIcon(env, SLUG, 192);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Icon not available');
  });

  it('returns 500 for invalid JSON', async () => {
    const env = makeEnv(makeDbMock({ pwa_config: '{' }));
    const res = await handlePWAIcon(env, SLUG, 512);
    expect(res.status).toBe(500);
  });

  it('returns PNG bytes for valid base64 icon', async () => {
    const config = makePwaConfig();
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config) }));
    const res = await handlePWAIcon(env, SLUG, 512);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');

    const body = new Uint8Array(await res.arrayBuffer());
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50);
  });

  it('returns 500 for invalid base64 icon data', async () => {
    const config = makePwaConfig({ icon: 'data:image/png;base64,!!!invalid!!!' });
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config) }));
    const res = await handlePWAIcon(env, SLUG, 192);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Invalid icon data');
  });
});

describe('handlePWAScreenshot', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv(makeDbMock(null));
    const res = await handlePWAScreenshot(env, SLUG, 'mobile');
    expect(res.status).toBe(404);
  });

  it('returns 500 for invalid config JSON', async () => {
    const env = makeEnv(makeDbMock({ pwa_config: 'bad', name: 'Demo' }));
    const res = await handlePWAScreenshot(env, SLUG, 'desktop');
    expect(res.status).toBe(500);
  });

  it('returns 404 when PWA disabled', async () => {
    const config = makePwaConfig({ enabled: false });
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config), name: 'Demo' }));
    const res = await handlePWAScreenshot(env, SLUG, 'mobile');
    expect(res.status).toBe(404);
  });

  it('generates mobile placeholder PNG', async () => {
    const config = makePwaConfig({ theme_color: '#00ff00', background_color: '#111111', name: 'App' });
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config), name: 'Fallback' }));
    const res = await handlePWAScreenshot(env, SLUG, 'mobile');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');

    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(100);
    expect(body[0]).toBe(0x89);
  });

  it('generates desktop placeholder PNG with artifact name fallback', async () => {
    const config = makePwaConfig({ name: '', theme_color: 'not-a-hex' });
    const env = makeEnv(makeDbMock({ pwa_config: JSON.stringify(config), name: 'Desktop App' }));
    const res = await handlePWAScreenshot(env, SLUG, 'desktop');

    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body[0]).toBe(0x89);
    expect(body.length).toBeGreaterThan(100);
  });
});
