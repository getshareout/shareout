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
const mockFetch = vi.fn();

import { recheckPendingModeration, recheckFailOpenModeration } from '../../../src/moderation/rescan';
import { setArtifactModeration } from '../../../src/superadmin/artifacts-admin';
import { runPublishModeration } from '../../../src/publish/moderation';
import { contentHash } from '../../../src/moderation/check';
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
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, workspace_id TEXT, owner_id TEXT, visibility TEXT, paused INTEGER DEFAULT 0, deleted_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'approved', reason TEXT, checked_at TEXT, content_hash TEXT, held_visibility TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT, channel TEXT, version_id TEXT, slug TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, entrypoint TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS assets (version_id TEXT, path TEXT, r2_key TEXT, mime TEXT)`);
});

beforeEach(async () => {
  for (const t of ['artifacts', 'artifact_moderation', 'deployments', 'versions', 'assets']) await e.DB.exec(`DELETE FROM ${t}`);
  mockFetch.mockReset();
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

  it('leaves a hold pending (still private) when the classifier errors — fail-open never releases a hold', async () => {
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
  it('records the held visibility on a new hold', async () => {
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

const RATE_LIMITED = { ok: false, status: 429 };

// A page that went public while the classifier was down: approved, unhashed, tagged.
async function seedFailOpen(id: string, html: string): Promise<void> {
  await seedHeld(id, html);
  await e.DB.prepare(`UPDATE artifacts SET visibility = 'public' WHERE id = ?`).bind(id).run();
  await e.DB.prepare(
    `UPDATE artifact_moderation SET status = 'approved', held_visibility = NULL, content_hash = NULL,
            reason = 'provider_error_fail_open: classifier http 429 (all providers)' WHERE artifact_id = ?`
  ).bind(id).run();
}

describe('classifier outage (fail-open)', () => {
  it('publishes public when every provider is rate-limited, queued for recheck', async () => {
    mockFetch.mockResolvedValue(RATE_LIMITED);
    await e.DB.prepare(
      `INSERT INTO artifacts (id, slug, workspace_id, visibility) VALUES (?,?,?,?)`
    ).bind('f1', 'f1', 'ws1', 'public').run();

    const status = await runPublishModeration(e, 'f1', '<p>hi</p>', 'public');

    expect(status).toMatchObject({ status: 'approved', forcedPrivate: false });
    expect(await row('f1')).toEqual({ moderation_status: 'approved', visibility: 'public', moderation_held_visibility: null });
    const m = await e.DB.prepare('SELECT reason, content_hash FROM artifact_moderation WHERE artifact_id = ?')
      .bind('f1').first<{ reason: string; content_hash: string | null }>();
    expect(m).toEqual({ reason: 'provider_error_fail_open: classifier http 429 (all providers)', content_hash: null });
  });

  it('re-classifies an identical republish instead of reusing the fail-open approval', async () => {
    await seedFailOpen('f2', '<p>same</p>');
    mockFetch.mockResolvedValue(aiResponse('suspicious', 'looks off'));
    const status = await runPublishModeration(e, 'f2', '<p>same</p>', 'public');
    expect(status.status).toBe('pending');
    expect(mockFetch).toHaveBeenCalled();
  });

  it('recheck pulls a fail-open page private when the real verdict is suspicious', async () => {
    await seedFailOpen('f3', '<p>x</p>');
    mockFetch.mockResolvedValue(aiResponse('suspicious', 'looks off'));

    const r = await recheckFailOpenModeration(e);

    expect(r).toEqual({ checked: 1, held: 1 });
    expect(await row('f3')).toEqual({ moderation_status: 'pending', visibility: 'private', moderation_held_visibility: 'public' });
    expect(vi.mocked(invalidateDeploymentCacheById)).toHaveBeenCalledWith(e, 'f3');
  });

  it('recheck confirms a clean fail-open page and drops it from the queue', async () => {
    await seedFailOpen('f4', '<p>ok</p>');
    mockFetch.mockResolvedValue(aiResponse('clean'));

    expect(await recheckFailOpenModeration(e)).toEqual({ checked: 1, held: 0 });
    expect(await row('f4')).toEqual({ moderation_status: 'approved', visibility: 'public', moderation_held_visibility: null });
    expect(await recheckFailOpenModeration(e)).toEqual({ checked: 0, held: 0 });
  });

  it('keeps a fail-open page live and queued while the outage continues', async () => {
    await seedFailOpen('f5', '<p>ok</p>');
    mockFetch.mockResolvedValue(RATE_LIMITED);

    expect(await recheckFailOpenModeration(e)).toEqual({ checked: 1, held: 0 });
    expect((await row('f5'))!.visibility).toBe('public');
    expect((await recheckFailOpenModeration(e)).checked).toBe(1);
  });

  it('drains a burst bigger than the 20/run pending sweep in one run', async () => {
    for (let i = 0; i < 25; i++) await seedFailOpen(`b${i}`, `<p>${i}</p>`);
    mockFetch.mockResolvedValue(aiResponse('clean'));
    expect(await recheckFailOpenModeration(e)).toEqual({ checked: 25, held: 0 });
  });

  it('skips deleted artifacts', async () => {
    await seedFailOpen('f6', '<p>ok</p>');
    await e.DB.prepare(`UPDATE artifacts SET deleted_at = '2026-01-01' WHERE id = ?`).bind('f6').run();
    expect((await recheckFailOpenModeration(e)).checked).toBe(0);
  });
});
