// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const U1_TOKEN = 'so_f33_u1_token';
const WS = 'wsp_f33';

const provision = (hub: string, body: unknown) =>
  handleFetch(new Request(`${BASE}/v1/data/${hub}/provision`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${U1_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), e, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

async function seedArtifact(id: string, owner: string, visibility: string, r2: string) {
  await e.DB.batch([
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, ?, ?, ?, ?, ?)').bind(id, id, `slug-${id}`, owner, WS, visibility),
    e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, ?)').bind(`ver_${id}`, id, 'index.html', '{}'),
  ]);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, `ver_${id}`, `slug-${id}`),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', 5, 'x')").bind(`ast_${id}`, `ver_${id}`, r2),
  ]);
  await e.ARTIFACTS.put(r2, '<p>PRIVATE CONTENT of u2</p>');
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f33_1', 'f33u1@example.test', 'u1'), ('usr_f33_2', 'f33u2@example.test', 'u2')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f33-w', 'usr_f33_2')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f33_1', ?, 'usr_f33_1', 'member', 'internal'), ('wm_f33_2', ?, 'usr_f33_2', 'owner', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f33_1', 'user', 'usr_f33_1', 'usr_f33_1', ?, 'u1')").bind(await hashToken(U1_TOKEN)),
  ]);
  await seedArtifact('art_f33_hub', 'usr_f33_1', 'workspace', 'f33/hub.html');
  await seedArtifact('art_f33_private', 'usr_f33_2', 'private', 'f33/private.html');
  await seedArtifact('art_f33_shared', 'usr_f33_2', 'workspace', 'f33/shared.html');
  await seedArtifact('art_f33_mine', 'usr_f33_1', 'private', 'f33/mine.html');
});

describe('f33 provision fromArtifact', () => {
  it('blocks: cannot clone another member\'s private artifact', async () => {
    const res = await provision('art_f33_hub', { name: 'stolen', fromArtifact: 'art_f33_private' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('template not accessible');
    const n = await e.DB.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE name = 'stolen'").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('can still clone a workspace-visible artifact and its own private artifact', async () => {
    for (const from of ['art_f33_shared', 'art_f33_mine']) {
      const res = await provision('art_f33_hub', { name: `ok-${from}`, fromArtifact: from });
      expect(res.status, await res.clone().text()).toBe(200);
    }
  });
});
