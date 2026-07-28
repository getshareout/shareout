import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';

vi.mock('../../../src/fetch-utils', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
  FetchTimeoutError: class extends Error {},
}));
vi.mock('../../../src/moderation/url-scanner', () => ({
  submitHostScan: async () => {},
  checkHostsReputation: async () => 'unknown',
}));
vi.mock('../../../src/serve/deployment-cache', () => ({ invalidateDeploymentCacheById: vi.fn(async () => {}) }));
vi.mock('../../../src/observability/alerts', () => ({
  fireAlert: vi.fn(async () => {}),
  notifyAdmin: vi.fn(async () => {}),
}));

const mockFetch = vi.fn();

import { recheckPendingModeration } from '../../../src/moderation/rescan';
import { setArtifactModeration } from '../../../src/superadmin/artifacts-admin';
import { runPublishModeration } from '../../../src/publish/moderation';
import { contentHash } from '../../../src/moderation/check';
import { fireAlert } from '../../../src/observability/alerts';
import { invalidateDeploymentCacheById } from '../../../src/serve/deployment-cache';

const e = env as unknown as Env;

function aiResponse(verdict: string, reason = 'ok') {
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict, reason }) } }] }) };
}

async function seedHeld(id: string, html: string): Promise<void> {
  const key = `r2/${id}`;
  await e.ARTIFACTS.put(key, html);
  await e.DB.prepare(
    `INSERT INTO artifacts (id, slug, name, workspace_id, visibility) VALUES (?,?,?,?,?)`
  ).bind(id, id, 'held', 'ws1', 'private').run();
  await e.DB.prepare(
    `INSERT INTO artifact_moderation (artifact_id, status, reason, held_visibility) VALUES (?,?,?,?)`
  ).bind(id, 'pending', 'held', 'public').run();
  await e.DB.prepare(`INSERT INTO versions (id, entrypoint) VALUES (?,?)`).bind(`v_${id}`, 'index.html').run();
  await e.DB.prepare(`INSERT INTO assets (version_id, path, r2_key, mime) VALUES (?,?,?,?)`).bind(`v_${id}`, 'index.html', key, 'text/html').run();
  await e.DB.prepare(`INSERT INTO deployments (artifact_id, channel, version_id, slug) VALUES (?,?,?,?)`).bind(id, 'production', `v_${id}`, id).run();
}

function row(id: string) {
  return e.DB.prepare(
    `SELECT COALESCE(m.status, 'approved') AS moderation_status, a.visibility,
            m.held_visibility AS moderation_held_visibility
       FROM artifacts a LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
      WHERE a.id = ?`
  ).bind(id)
    .first<{ moderation_status: string; visibility: string; moderation_held_visibility: string | null }>();
}

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, workspace_id TEXT, owner_id TEXT, visibility TEXT, paused INTEGER DEFAULT 0)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'approved', reason TEXT, checked_at TEXT, content_hash TEXT, held_visibility TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT, channel TEXT, version_id TEXT, slug TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, entrypoint TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS assets (version_id TEXT, path TEXT, r2_key TEXT, mime TEXT)`);
});

beforeEach(async () => {
  for (const t of ['artifacts', 'artifact_moderation', 'deployments', 'versions', 'assets']) await e.DB.exec(`DELETE FROM ${t}`);
  mockFetch.mockReset();
  vi.mocked(fireAlert).mockClear();
  vi.mocked(invalidateDeploymentCacheById).mockClear();
  (e as unknown as { OPENAI_API_KEY: string }).OPENAI_API_KEY = 'sk-test';
});

describe('recheckPendingModeration', () => {
  it('approves a self-healed hold and restores the held visibility', async () => {
    mockFetch.mockResolvedValue(aiResponse('clean'));
    await seedHeld('a1', '<p>ok</p>');
    const r = await recheckPendingModeration(e);
    expect(r.approved).toBe(1);
    expect(await row('a1')).toEqual({ moderation_status: 'approved', visibility: 'public', moderation_held_visibility: null });
    expect(vi.mocked(invalidateDeploymentCacheById)).toHaveBeenCalledWith(e, 'a1');
  });

  it('leaves a hold pending (still private) when the classifier errors', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    await seedHeld('a2', '<p>x</p>');
    const r = await recheckPendingModeration(e);
    expect(r.approved).toBe(0);
    expect(await row('a2')).toEqual({ moderation_status: 'pending', visibility: 'private', moderation_held_visibility: 'public' });
  });
});

describe('setArtifactModeration approve', () => {
  it('restores the held visibility on approve', async () => {
    await e.DB.prepare(
      `INSERT INTO artifacts (id, slug, visibility) VALUES (?,?,?)`
    ).bind('a3', 'a3', 'private').run();
    await e.DB.prepare(
      `INSERT INTO artifact_moderation (artifact_id, status, held_visibility) VALUES (?,?,?)`
    ).bind('a3', 'pending', 'public').run();
    const res = await setArtifactModeration(e, 'a3', 'approve');
    expect(res.ok).toBe(true);
    expect(await row('a3')).toEqual({ moderation_status: 'approved', visibility: 'public', moderation_held_visibility: null });
  });
});

describe('runPublishModeration', () => {
  it('records the held visibility and fires a super-admin alert on a new hold', async () => {
    mockFetch.mockResolvedValue(aiResponse('suspicious', 'looks off'));
    await e.DB.prepare(
      `INSERT INTO artifacts (id, slug, workspace_id, visibility) VALUES (?,?,?,?)`
    ).bind('a4', 'a4', 'ws1', 'public').run();

    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(Promise.resolve(p)) } as unknown as ExecutionContext;
    const status = await runPublishModeration(e, 'a4', '<p>hi</p>', 'public', ctx);
    await Promise.all(waits);

    expect(status.status).toBe('pending');
    expect(await row('a4')).toEqual({ moderation_status: 'pending', visibility: 'private', moderation_held_visibility: 'public' });
    expect(vi.mocked(fireAlert)).toHaveBeenCalledWith(e, 'moderation:held:a4', expect.stringContaining('held for review'), 6 * 3600);
  });

  it('republish as private clears the hold so the recheck cannot flip it public', async () => {
    mockFetch.mockResolvedValue(aiResponse('clean'));
    await seedHeld('a5', '<p>ok</p>');
    // Give the held row a content hash matching the current content — the clear must
    // drop it, or a later public re-attempt would hash-skip past the classifier.
    await e.DB.prepare('UPDATE artifact_moderation SET content_hash = ? WHERE artifact_id = ?')
      .bind(await contentHash('<p>ok</p>'), 'a5').run();
    const status = await runPublishModeration(e, 'a5', '<p>ok</p>', 'private');
    expect(status.status).toBe('approved');
    // Hold cleared: approved + no held marker, so serve shows the normal login wall
    // (not the under-review page, which keys on pending + held_visibility).
    expect(await row('a5')).toEqual({ moderation_status: 'approved', visibility: 'private', moderation_held_visibility: null });
    expect(vi.mocked(invalidateDeploymentCacheById)).toHaveBeenCalledWith(e, 'a5');

    const r = await recheckPendingModeration(e);
    expect(r.checked).toBe(0);
    expect((await row('a5'))!.visibility).toBe('private');

    // Bypass guard: flipping back to public must re-classify the never-cleared content,
    // not skip on the administrative 'approved' + stale hash.
    const hashRow = await e.DB.prepare('SELECT content_hash AS h FROM artifact_moderation WHERE artifact_id = ?')
      .bind('a5').first<{ h: string | null }>();
    expect(hashRow!.h).toBeNull();
    mockFetch.mockResolvedValue(aiResponse('suspicious', 'still unreviewed'));
    const again = await runPublishModeration(e, 'a5', '<p>ok</p>', 'public');
    expect(again.status).toBe('pending');
    expect((await row('a5'))!.visibility).toBe('private');
  });

  it('does not clear a blocked takedown on a non-public republish', async () => {
    await e.DB.prepare(
      `INSERT INTO artifacts (id, slug, visibility) VALUES (?,?,?)`
    ).bind('a6', 'a6', 'private').run();
    await e.DB.prepare(
      `INSERT INTO artifact_moderation (artifact_id, status, held_visibility) VALUES (?,?,?)`
    ).bind('a6', 'blocked', 'public').run();
    await runPublishModeration(e, 'a6', '<p>x</p>', 'private');
    expect((await row('a6'))!.moderation_status).toBe('blocked');
  });
});
