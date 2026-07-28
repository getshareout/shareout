import { beforeAll, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';

/** Agent flow: check skill version before doing any work (avoids stale docs). */
describe(`01 agent skill discovery @ ${baseUrl}`, () => {
  it('HEAD /v1/skill returns version headers', async () => {
    const response = await fetch(`${baseUrl}/v1/skill`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Skill-Version')).toMatch(/^\d+\.\d+\.\d+/);
    expect(response.headers.get('ETag')).toBeTruthy();
  });

  it('GET /v1/skill/version returns semver JSON', async () => {
    const { response, body } = await ShareOutClient.anonymous().request<{ version: string; updated_at: string }>(
      '/v1/skill/version'
    );

    expect(response.status).toBe(200);
    expect(body?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body?.updated_at).toBeTruthy();
  });

  it('GET /v1/skill/meta lists available skill sections', async () => {
    const { response, body } = await ShareOutClient.anonymous().request<{
      name: string;
      version: string;
      sections: string[];
      endpoints: Record<string, string>;
    }>('/v1/skill/meta');

    expect(response.status).toBe(200);
    expect(body?.name).toBe('shareout-skill');
    expect(body?.sections).toContain('Authentication');
    expect(body?.endpoints.full).toContain('/v1/skill');
  });

  it('GET /v1/skill returns the full skill zip when agent needs details', async () => {
    const response = await fetch(`${baseUrl}/v1/skill`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const entries = Object.fromEntries(
      Object.entries(unzipSync(bytes)).map(([name, data]) => [name, new TextDecoder().decode(data)]),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(entries['SKILL.md']).toContain('POST /v1/publish');
    expect(Object.keys(entries).some((name) => name.includes('api/') || name.includes('sdk/'))).toBe(true);
  });
});
