import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import type { Env } from '../../src/types';

const BASE = 'https://shareout.example.com';
const PWA = JSON.stringify({ enabled: true, name: 'Secret App', short_name: 'Secret', description: 'internal', icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });

function makeEnv(visibility: string, pwa = PWA): Env {
  const deployment = {
    deploy_slug: 'app', version_id: 'ver_1', entrypoint: 'index.html', artifact_id: 'art_1',
    artifact_name: 'Secret App', visibility, auth_method: 'google', owner_id: 'usr_owner',
    workspace_id: null, paused: 0, moderation_status: 'approved', pwa_config: pwa,
    r2_key: null, mime: null, size_bytes: null,
  };
  const stmt = (sql: string) => {
    const s = {
      bind: () => s,
      first: async () => {
        if (sql.includes('pres_a.pwa_config') && sql.includes('FROM deployments')) {
          return sql.includes('ast.r2_key') ? deployment : { pwa_config: pwa, name: 'Secret App' };
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => ({ meta: {} }),
    };
    return s;
  };
  return {
    SHAREOUT_BASE_URL: BASE,
    SESSION_SECRET: 'session-secret',
    DB: { prepare: stmt, batch: async () => [] },
  } as unknown as Env;
}

const PATHS = ['sw.js', '_pwa/screenshot-mobile.png'];

describe('PWA assets follow the artifact access gate', () => {
  it.each(PATHS)('private artifact: anonymous %s is denied', async (p) => {
    const res = await worker.fetch(new Request(`${BASE}/a/app/${p}`), makeEnv('private'));
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(300);
    const body = await res.text();
    expect(body).not.toContain('Secret App');
    expect(body).not.toContain('internal');
  });

  it('private artifact: anonymous manifest.json is served without description or screenshots (install needs it)', async () => {
    const res = await worker.fetch(new Request(`${BASE}/a/app/manifest.json`), makeEnv('private'));
    expect(res.status).toBe(200);
    const m = await res.json() as { name: string; description: string; screenshots: unknown[]; icons: unknown[] };
    expect(m.name).toBe('Secret App');
    expect(m.description).toBe('');
    expect(m.screenshots).toEqual([]);
    expect(m.icons.length).toBeGreaterThan(0);
  });

  it('private artifact: anonymous manifest never falls back to the artifact title', async () => {
    const unnamed = JSON.stringify({ ...JSON.parse(PWA), name: undefined, short_name: undefined });
    const res = await worker.fetch(new Request(`${BASE}/a/app/manifest.json`), makeEnv('private', unnamed));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('Secret App');
    expect((JSON.parse(body) as { name: string }).name).toBe('ShareOut');
  });

  it('private artifact: anonymous icon is served', async () => {
    const res = await worker.fetch(new Request(`${BASE}/a/app/_pwa/icon-192.png`), makeEnv('private'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it.each(['manifest.json', '_pwa/icon-192.png', ...PATHS])('public artifact: anonymous %s is served', async (p) => {
    const res = await worker.fetch(new Request(`${BASE}/a/app/${p}`), makeEnv('public'));
    expect(res.status).toBe(200);
  });
});
