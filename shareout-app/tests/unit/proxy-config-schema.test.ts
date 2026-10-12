// @vitest-environment node
// Saving an artifact's proxy config runs against the real migrated schema.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from './helpers/migrated-db';
import { handleProxyConfig } from '../../src/proxy';
import * as middleware from '../../src/data/middleware';
import type { DataContext } from '../../src/data/middleware';

const ART = 'art_proxycfg';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_proxycfg', 'p@example.com', 'P')"),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'P', ?, 'usr_proxycfg', 'private')").bind(ART, ART),
  ]);
});

const ctx = {
  artifactId: ART,
  workspaceId: '',
  artifact: { id: ART, name: 'P', visibility: 'private', auth_method: null, workspace_id: null, owner_id: 'usr_proxycfg' },
  env: e,
  origin: null,
} as unknown as DataContext;

function put(body: unknown) {
  return handleProxyConfig(
    new Request(`https://shareout.site/v1/data/${ART}/proxy/config`, { method: 'PUT', body: JSON.stringify(body) }),
    ctx
  );
}

describe('PUT /v1/data/{id}/proxy/config', () => {
  it('creates and then updates the config', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    const first = await put({ enabled: false, allowed_hosts: ['api.example.com'] });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ data: { enabled: false, allowed_hosts: ['api.example.com'] } });

    const second = await put({ cache_ttl: 60 });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ data: { enabled: false, allowed_hosts: ['api.example.com'], cache_ttl: 60 } });
  });
});
