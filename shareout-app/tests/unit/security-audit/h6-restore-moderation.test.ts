import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';

const check = vi.hoisted(() => vi.fn());
vi.mock('../../../src/moderation/check', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runPublishSafetyCheck: check,
}));

import type { AuthUser } from '../../../src/api-auth';
import { handleRestoreVersion } from '../../../src/artifacts';

const owner: AuthUser = { id: 'usr_h6rv_o', email: 'h6rv@x.test', username: null };
const WS = 'wsp_h6rv';
const PUB = 'art_h6rv_pub';
const GOV = 'art_h6rv_gov';
const OLD = '<html>login to your bank</html>';

const vis = async (id: string) =>
  (await e.DB.prepare('SELECT visibility FROM artifacts WHERE id = ?').bind(id).first<{ visibility: string }>())?.visibility;
const restore = (id: string) => handleRestoreVersion(new Request('https://x', { method: 'POST' }), e, owner, id, 1);

beforeAll(async () => {
  await applyMigrations();
  const seed = async (id: string, ws: string | null) => {
    await env.ARTIFACTS.put(`${id}/ver_${id}_1/index.html`, OLD);
    await env.ARTIFACTS.put(`${id}/ver_${id}_2/index.html`, '<html>ok</html>');
    return [
      e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, ?, 'public', ?)").bind(id, id, `s-${id}`, owner.id, ws),
      e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, 'index.html', '{}'), (?, ?, 2, 'index.html', '{}')")
        .bind(`ver_${id}_1`, id, `ver_${id}_2`, id),
      e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', 30, 'h'), (?, ?, 'index.html', ?, 'text/html', 15, 'h2')")
        .bind(`ast_${id}_1`, `ver_${id}_1`, `${id}/ver_${id}_1/index.html`, `ast_${id}_2`, `ver_${id}_2`, `${id}/ver_${id}_2/index.html`),
      e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, `ver_${id}_2`, `s-${id}`),
    ];
  };
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(owner.id, owner.email),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id, public_publish_policy) VALUES (?, 'W', 'w-h6rv', ?, 'require_approval')").bind(WS, owner.id),
    ...(await seed(PUB, null)),
    ...(await seed(GOV, WS)),
  ]);
});

describe('h6 version restore keeps the publish gates', () => {
  it('blocks: restoring flagged content onto a public artifact is moderated and held private', async () => {
    check.mockReset().mockResolvedValue({ verdict: 'malicious', status: 'blocked', reason: 'phish', contentHash: 'h' });
    expect((await restore(PUB)).status).toBe(201);
    expect(check).toHaveBeenCalledTimes(1);
    expect(await vis(PUB)).toBe('private');
  });

  it('blocks: workspace require_approval is not bypassed by restoring an old version', async () => {
    check.mockReset().mockResolvedValue({ verdict: 'clean', status: 'approved', reason: '', contentHash: 'h2' });
    expect((await restore(GOV)).status).toBe(201);
    expect(await vis(GOV)).toBe('workspace');
  });

  it('a clean restore on a public artifact stays public', async () => {
    await e.DB.prepare("UPDATE artifacts SET visibility = 'public' WHERE id = ?").bind(PUB).run();
    check.mockReset().mockResolvedValue({ verdict: 'clean', status: 'approved', reason: '', contentHash: 'h3' });
    expect((await restore(PUB)).status).toBe(201);
    expect(await vis(PUB)).toBe('public');
  });
});
