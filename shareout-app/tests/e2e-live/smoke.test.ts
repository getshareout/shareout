import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { ShareOutClient } from './helpers/client';
import { baseUrl } from './helpers/env';

const client = ShareOutClient.anonymous();

describe(`live smoke @ ${baseUrl}`, () => {
  it('health check returns ok', async () => {
    const { response, body } = await client.request<{ status: string; ts: number }>('/health');

    expect(response.status).toBe(200);
    expect(body?.status).toBe('ok');
    expect(typeof body?.ts).toBe('number');
  });

  it('landing page is HTML with ShareOut branding', async () => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    // When MARKETING_US_BLOCKED=1, US IPs get a plain 404 on `/` only.
    if (response.status === 404 && html.includes('Not Available')) return;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('ShareOut');
  });

  it('skill endpoint serves the full skill zip bundle', async () => {
    const response = await fetch(`${baseUrl}/v1/skill`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const entries = Object.fromEntries(
      Object.entries(unzipSync(bytes)).map(([name, data]) => [name, new TextDecoder().decode(data)]),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('X-Skill-Version')).toBeTruthy();
    expect(entries['SKILL.md']).toContain('ShareOut Skill');
    expect(entries['SKILL.md']).toContain('/v1/publish');
  });

  it('skill version endpoint returns JSON metadata', async () => {
    const { response, body } = await client.request<{ version: string }>('/v1/skill/version');

    expect(response.status).toBe(200);
    expect(body?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('SDK bundles are served', async () => {
    const shareout = await fetch(`${baseUrl}/sdk/shareout.js`);
    const editor = await fetch(`${baseUrl}/sdk/editor.js`, {
      headers: { 'Sec-Fetch-Dest': 'script' },
    });

    expect(shareout.ok).toBe(true);
    expect((await shareout.text()).length).toBeGreaterThan(1000);

    expect(editor.ok).toBe(true);
    expect((await editor.text()).length).toBeGreaterThan(10_000);
  });

  it('publish endpoint responds to CORS preflight', async () => {
    const response = await fetch(`${baseUrl}/v1/publish`, { method: 'OPTIONS' });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('protected API routes reject unauthenticated requests', async () => {
    const { response, body } = await client.request<{ error: string; code: string }>('/v1/artifacts');

    expect(response.status).toBe(401);
    expect(body?.code).toBe('UNAUTHORIZED');
  });

  it('Google OAuth login redirects to Google', async () => {
    const response = await fetch(`${baseUrl}/auth/google?redirect=/`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('accounts.google.com/o/oauth2');
  });

  it('global proxy requires auth (no anonymous SSRF relay)', async () => {
    const { response } = await client.request<{ code: string }>(
      `/api/proxy?url=${encodeURIComponent('http://127.0.0.1/secret')}`
    );

    expect(response.status).toBe(401);
  });
});
