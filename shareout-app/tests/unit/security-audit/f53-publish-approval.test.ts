// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import { createPublishApproval, decidePublishApproval } from '../../../src/publish-approval';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

let verdict: 'approved' | 'pending' = 'approved';
vi.mock('../../../src/moderation/check', async (orig) => ({
  ...(await orig<object>()),
  classifyAndPersist: async () => verdict,
}));

const BASE = 'https://shareout.example.com';
const WS = 'wsp_f53';
const TOKEN = (n: number) => `so_f53_u${n}_token`;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

async function seedArtifact(id: string, owner: string, visibility: string, html: string) {
  await e.DB.batch([
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, ?, ?, ?, ?, ?)').bind(id, id, `slug-${id}`, owner, WS, visibility),
    e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, ?)').bind(`ver_${id}`, id, 'index.html', '{}'),
  ]);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, `ver_${id}`, `slug-${id}`),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', 5, 'x')").bind(`ast_${id}`, `ver_${id}`, `f53/${id}.html`),
  ]);
  await e.ARTIFACTS.put(`f53/${id}.html`, html);
}

const vis = async (id: string) => (await e.DB.prepare('SELECT visibility FROM artifacts WHERE id = ?').bind(id).first<{ visibility: string }>())?.visibility;
const create = (artifactId: string, n: number, approvers: string[]) =>
  handleFetch(new Request(`${BASE}/v1/artifacts/${artifactId}/publish-approval`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN(n)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility: 'public', approver_ids: approvers }),
  }), e, ctx);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f53_1','f53a@example.test','a'),('usr_f53_2','f53b@example.test','b'),('usr_f53_3','f53c@example.test','c')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id, public_publish_policy, public_publish_approvals_required) VALUES (?, 'W', 'f53-w', 'usr_f53_1', 'require_approval', 1)").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f53_1', ?, 'usr_f53_1', 'owner', 'internal'), ('wm_f53_2', ?, 'usr_f53_2', 'member', 'internal'), ('wm_f53_3', ?, 'usr_f53_3', 'member', 'internal')").bind(WS, WS, WS),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f53_2','user','usr_f53_2','usr_f53_2',?, 'u2'), ('tok_f53_3','user','usr_f53_3','usr_f53_3',?, 'u3')").bind(await hashToken(TOKEN(2)), await hashToken(TOKEN(3))),
  ]);
});

describe('f55 create approval authorization', () => {
  it('blocks: a non-editor member cannot open an approval on another member\'s private artifact', async () => {
    await seedArtifact('art_f55_priv', 'usr_f53_1', 'private', '<p>v1</p>');
    const res = await create('art_f55_priv', 2, ['usr_f53_3']);
    expect(res.status).toBe(403);
    const n = await e.DB.prepare("SELECT COUNT(*) AS n FROM artifact_publish_approvals WHERE artifact_id = 'art_f55_priv'").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('the artifact owner can still request approval', async () => {
    await seedArtifact('art_f55_own', 'usr_f53_2', 'workspace', '<p>v1</p>');
    const res = await create('art_f55_own', 2, ['usr_f53_3']);
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it('a workspace admin/owner can request approval on a member artifact', async () => {
    await seedArtifact('art_f55_adm', 'usr_f53_2', 'workspace', '<p>v1</p>');
    const r = await createPublishApproval(e, { artifactId: 'art_f55_adm', workspaceId: WS, requesterId: 'usr_f53_1', visibility: 'public', approverIds: ['usr_f53_3'] });
    expect(r.ok).toBe(true);
  });
});

describe('f53 stale content', () => {
  it('blocks: approval of a replaced page does not publish it', async () => {
    await seedArtifact('art_f53', 'usr_f53_2', 'workspace', '<p>reviewed v1</p>');
    const r = await createPublishApproval(e, { artifactId: 'art_f53', workspaceId: WS, requesterId: 'usr_f53_2', visibility: 'public', approverIds: ['usr_f53_3'] });
    expect(r.ok).toBe(true);
    await e.ARTIFACTS.put('f53/art_f53.html', '<p>unreviewed v2</p>');
    const d = await decidePublishApproval(e, r.id!, 'usr_f53_3', 'approve');
    expect(d.ok).toBe(false);
    expect(await vis('art_f53')).toBe('workspace');
  });

  it('approval of unchanged content publishes', async () => {
    verdict = 'approved';
    await seedArtifact('art_f53_ok', 'usr_f53_2', 'workspace', '<p>same</p>');
    const r = await createPublishApproval(e, { artifactId: 'art_f53_ok', workspaceId: WS, requesterId: 'usr_f53_2', visibility: 'public', approverIds: ['usr_f53_3'] });
    const d = await decidePublishApproval(e, r.id!, 'usr_f53_3', 'approve');
    expect(d.status).toBe('approved');
    expect(await vis('art_f53_ok')).toBe('public');
  });
});

describe('f54 gates after approval', () => {
  it('blocks: a classifier hold keeps the page private with the public visibility held', async () => {
    verdict = 'pending';
    await seedArtifact('art_f54', 'usr_f53_2', 'workspace', '<p>sus</p>');
    const r = await createPublishApproval(e, { artifactId: 'art_f54', workspaceId: WS, requesterId: 'usr_f53_2', visibility: 'public', approverIds: ['usr_f53_3'] });
    const d = await decidePublishApproval(e, r.id!, 'usr_f53_3', 'approve');
    expect(d.status).toBe('approved');
    expect(await vis('art_f54')).toBe('private');
    const m = await e.DB.prepare("SELECT held_visibility FROM artifact_moderation WHERE artifact_id = 'art_f54'").first<{ held_visibility: string | null }>();
    expect(m?.held_visibility).toBe('public');
    verdict = 'approved';
  });

  it('blocks: a page loading a non-allowlisted CDN script is not made public', async () => {
    await seedArtifact('art_f54_cdn', 'usr_f53_2', 'workspace', '<script src="https://evil-cdn.example.invalid/x.js"></script>');
    const r = await createPublishApproval(e, { artifactId: 'art_f54_cdn', workspaceId: WS, requesterId: 'usr_f53_2', visibility: 'public', approverIds: ['usr_f53_3'] });
    const d = await decidePublishApproval(e, r.id!, 'usr_f53_3', 'approve');
    expect(d.ok).toBe(false);
    expect(await vis('art_f54_cdn')).toBe('workspace');
  });

  it('blocks: open visibility disabled on the instance is honoured', async () => {
    await seedArtifact('art_f54_off', 'usr_f53_2', 'workspace', '<p>x</p>');
    const r = await createPublishApproval(e, { artifactId: 'art_f54_off', workspaceId: WS, requesterId: 'usr_f53_2', visibility: 'public', approverIds: ['usr_f53_3'] });
    const off = { ...e, OPEN_VISIBILITY_DISABLED: 'true' } as unknown as typeof e;
    const d = await decidePublishApproval(off, r.id!, 'usr_f53_3', 'approve');
    expect(d.ok).toBe(false);
    expect(await vis('art_f54_off')).toBe('workspace');
  });
});
