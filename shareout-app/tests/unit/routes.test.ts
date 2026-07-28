import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import worker from '../../src/index';
import type { Env } from '../../src/types';

// Skill content is served from R2 (the `skill/*` objects synced by
// scripts/sync-skill-to-r2.mjs). Mock the bucket so /v1/skill routes resolve.
const SKILL_META = {
  name: 'shareout-skill',
  version: '1.5.0',
  updated_at: '2025-05-29T00:00:00Z',
  description: 'ShareOut HTML artifacts skill',
};
const SKILL_MD = '---\nname: "shareout-skill"\n---\n\nPOST /v1/publish\n';
const TEAM_SKILL_MD = '---\nname: "shareout-teams-skill"\n---\n\nTeams workspace administration.\n';
const SKILL_INDEX = '| **Authentication** | auth |\n| **API Reference** | api |\n';
const SKILL_BUNDLE = zipSync({
  'SKILL.md': new TextEncoder().encode(SKILL_MD),
  'INDEX.md': new TextEncoder().encode(SKILL_INDEX),
  'team/SKILL.md': new TextEncoder().encode(TEAM_SKILL_MD),
});
const SKILL_R2: Record<string, {
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  body: string | Uint8Array;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}> = {
  'skill/_meta.json': { json: async () => SKILL_META, text: async () => JSON.stringify(SKILL_META), body: JSON.stringify(SKILL_META) },
  'skill/SKILL.md': { json: async () => ({}), text: async () => SKILL_MD, body: SKILL_MD },
  'skill/INDEX.md': { json: async () => ({}), text: async () => SKILL_INDEX, body: SKILL_INDEX },
  'skill/team/SKILL.md': { json: async () => ({}), text: async () => TEAM_SKILL_MD, body: TEAM_SKILL_MD },
  'skill/_bundle.zip': {
    json: async () => ({}),
    text: async () => '',
    body: SKILL_BUNDLE,
    arrayBuffer: async () => SKILL_BUNDLE.buffer.slice(
      SKILL_BUNDLE.byteOffset,
      SKILL_BUNDLE.byteOffset + SKILL_BUNDLE.byteLength,
    ),
  },
};

const env = {
  SHAREOUT_BASE_URL: 'https://shareout.example.com',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  SESSION_SECRET: 'session-secret',
  ARTIFACTS: { get: async (key: string) => SKILL_R2[key] ?? null },
} as unknown as Env;

async function fetchPath(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://shareout.example.com${path}`, init), env);
}

describe('worker routes', () => {
  it('responds to CORS preflight requests', async () => {
    const response = await fetchPath('/v1/publish', { method: 'OPTIONS' });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('returns a health payload', async () => {
    const response = await fetchPath('/health');
    const body = await response.json() as { status: string; ts: number };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(typeof body.ts).toBe('number');
  });

  it('sends a visitor at root to first-run setup while the instance has no users', async () => {
    const response = await fetchPath('/');

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('/setup');
  });

  it('guards artifact management routes without a bearer token', async () => {
    const response = await fetchPath('/v1/artifacts');
    const body = await response.json() as { error: string; code: string };

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(body).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('redirects Google login to the configured OAuth client', async () => {
    const response = await fetchPath('/auth/google?redirect=/a/demo/');
    const location = response.headers.get('Location');

    expect(response.status).toBe(302);
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('client_id=google-client');
    expect(location).toContain('redirect_uri=https%3A%2F%2Fshareout.example.com%2Fauth%2Fcallback');
  });

  it('redirects Telegram settings to login when signed out', async () => {
    const response = await fetchPath('/settings/telegram');
    const location = response.headers.get('Location');

    expect(response.status).toBe(302);
    expect(location).toContain('/auth/login');
    expect(location).toContain('redirect=/settings/telegram');
  });

  it('does not serve the removed /app surface', async () => {
    const response = await fetchPath('/app');

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('Not Found');
  });

  it('returns 404 for unknown routes under a reserved namespace', async () => {
    // Unknown *site* paths now delegate to the marketing site; unknown paths
    // under a reserved product namespace keep the worker's own 404.
    const response = await fetchPath('/api/unknown');

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('Not Found');
  });

  it('serves the skill zip bundle at GET /v1/skill', async () => {
    const response = await fetchPath('/v1/skill');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const entries = unzipSync(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toContain('shareout-skill-1.5.0.zip');
    expect(response.headers.get('X-Skill-Version')).toMatch(/^\d+\.\d+\.\d+/);
    expect(new TextDecoder().decode(entries['SKILL.md'])).toContain('name: "shareout-skill"');
  });

  it('returns skill version headers on HEAD /v1/skill', async () => {
    const response = await fetchPath('/v1/skill', { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Skill-Version')).toMatch(/^\d+\.\d+\.\d+/);
    expect(response.headers.get('ETag')).toBeTruthy();
    expect(await response.text()).toBe('');
  });

  it('returns 304 for GET /v1/skill when If-None-Match matches', async () => {
    const head = await fetchPath('/v1/skill', { method: 'HEAD' });
    const etag = head.headers.get('ETag');

    const response = await fetchPath('/v1/skill', {
      headers: { 'If-None-Match': etag ?? '' },
    });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });

  it('returns skill version JSON at GET /v1/skill/version', async () => {
    const response = await fetchPath('/v1/skill/version');
    const body = await response.json() as { version: string; updated_at: string };

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.updated_at).toBeTruthy();
  });

  it('returns skill metadata at GET /v1/skill/meta', async () => {
    const response = await fetchPath('/v1/skill/meta');
    const body = await response.json() as {
      name: string;
      sections: string[];
      endpoints: Record<string, string>;
    };

    expect(response.status).toBe(200);
    expect(body.name).toBe('shareout-skill');
    expect(body.sections).toContain('Authentication');
    expect(body.endpoints.full).toBe('GET /v1/skill');
  });

  it('serves the Teams skill overlay at GET /v1/skill/team', async () => {
    const response = await fetchPath('/v1/skill/team');
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/markdown');
    expect(text).toContain('name: "shareout-teams-skill"');
  });
});
