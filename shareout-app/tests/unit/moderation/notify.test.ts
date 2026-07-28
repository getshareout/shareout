import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';

const dispatchMock = vi.fn(async () => ({ sent: true }));
vi.mock('../../../src/email/gateway', () => ({
  dispatchLifecycleEmail: (...a: unknown[]) => dispatchMock(...a),
}));
vi.mock('../../../src/serve/deployment-cache', () => ({ invalidateDeploymentCacheById: async () => {} }));

import { restoreHeldVisibility } from '../../../src/moderation/check';
import { setArtifactModeration } from '../../../src/superadmin/artifacts-admin';

const e = env as unknown as Env;

async function events(id: string) {
  return e.DB.prepare(
    `SELECT json_extract(payload, '$.event') AS event,
            recipient_id AS owner_user_id,
            json_extract(payload, '$.slug') AS slug
       FROM notifications WHERE kind = 'moderation' AND subject_id = ?`
  ).bind(id).all<{ event: string; owner_user_id: string; slug: string | null }>();
}

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, workspace_id TEXT, owner_id TEXT, visibility TEXT, paused INTEGER DEFAULT 0)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'approved', reason TEXT, checked_at TEXT, content_hash TEXT, held_visibility TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT, channel TEXT, version_id TEXT, slug TEXT)`);
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_type TEXT NOT NULL, recipient_id TEXT NOT NULL, kind TEXT NOT NULL, subject_type TEXT, subject_id TEXT, message TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  );
});

beforeEach(async () => {
  for (const t of ['artifacts', 'artifact_moderation', 'deployments', 'notifications']) await e.DB.exec(`DELETE FROM ${t}`);
  dispatchMock.mockClear();
});

describe('restoreHeldVisibility → owner notification', () => {
  it('inserts an approved bell event and sends the email on a real restore', async () => {
    await e.DB.prepare(
      `INSERT INTO artifacts (id, slug, name, owner_id, visibility) VALUES (?,?,?,?,?)`
    ).bind('a1', 'a1', 'My Page', 'usr1', 'private').run();
    await e.DB.prepare(
      `INSERT INTO artifact_moderation (artifact_id, status, held_visibility) VALUES (?,?,?)`
    ).bind('a1', 'approved', 'public').run();

    await restoreHeldVisibility(e, 'a1');

    const ev = await events('a1');
    expect(ev.results.length).toBe(1);
    expect(ev.results[0]).toMatchObject({ event: 'approved', owner_user_id: 'usr1', slug: 'a1' });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(e, expect.objectContaining({ type: 'moderation_approved', toUserId: 'usr1' }));
  });

  it('is idempotent — a second restore (nothing held) fires nothing', async () => {
    await e.DB.prepare(
      `INSERT INTO artifacts (id, slug, name, owner_id, visibility) VALUES (?,?,?,?,?)`
    ).bind('a1', 'a1', 'My Page', 'usr1', 'private').run();
    await e.DB.prepare(
      `INSERT INTO artifact_moderation (artifact_id, status, held_visibility) VALUES (?,?,?)`
    ).bind('a1', 'approved', 'public').run();
    await restoreHeldVisibility(e, 'a1');
    dispatchMock.mockClear();

    await restoreHeldVisibility(e, 'a1');
    expect((await events('a1')).results.length).toBe(1);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('setArtifactModeration block → owner notification', () => {
  it('inserts a blocked bell event (no email) once per transition', async () => {
    await e.DB.prepare(
      `INSERT INTO artifacts (id, slug, name, owner_id, visibility) VALUES (?,?,?,?,?)`
    ).bind('a2', 'a2', 'Bad Page', 'usr2', 'private').run();
    await e.DB.prepare(
      `INSERT INTO artifact_moderation (artifact_id, status) VALUES (?,?)`
    ).bind('a2', 'pending').run();

    await setArtifactModeration(e, 'a2', 'block', 'phishing');
    let ev = await events('a2');
    expect(ev.results.length).toBe(1);
    expect(ev.results[0]).toMatchObject({ event: 'blocked', owner_user_id: 'usr2' });
    expect(dispatchMock).not.toHaveBeenCalled();

    // Re-block an already-blocked page → no second notification.
    await setArtifactModeration(e, 'a2', 'block', 'still bad');
    ev = await events('a2');
    expect(ev.results.length).toBe(1);
  });
});
