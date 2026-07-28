// Auto TL;DR + tags on publish. Real Miniflare D1 + R2; the LLM call is mocked so the
// dedupe guard and DB writes are exercised without network. Description/tags land in
// the existing `description` column and `artifact_tags` table — the same columns
// quick-search (src/search/quick-search.ts) already reads, so this also pins that
// generated summaries/tags are stored where search finds them.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';

const chatComplete = vi.fn(async () => '{"summary":"A dashboard of quarterly revenue.","tags":["Revenue","Q3","Dashboard"]}');
vi.mock('../../../src/data/agent/anthropic', () => ({
  chatComplete: (...a: unknown[]) => chatComplete(...a),
  getAIProvider: () => ({ provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4o' }),
}));

const { generateArtifactSummary } = await import('../../../src/publish/auto-summary');

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, owner_id TEXT, description TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifact_presentation (artifact_id TEXT PRIMARY KEY, social_title TEXT, social_description TEXT, social_image_url TEXT, thumbnail_ext TEXT, thumbnail_generated_at TEXT, pwa_config TEXT, has_mobile INTEGER NOT NULL DEFAULT 0, embed_allowed INTEGER NOT NULL DEFAULT 1, embed_origins TEXT, editor_readiness TEXT, auto_summary_hash TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, artifact_id TEXT, version_id TEXT, channel TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, artifact_id TEXT, entrypoint TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, version_id TEXT, path TEXT, r2_key TEXT, mime TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifact_tags (id TEXT PRIMARY KEY, artifact_id TEXT, label TEXT, UNIQUE(artifact_id, label))`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT, model TEXT, units INTEGER, unit_kind TEXT, base_cost_micro_usd INTEGER, source TEXT, created_at TEXT)`);
});

async function seedArtifact(id: string, opts: { html?: string; description?: string | null } = {}) {
  await e.DB.prepare(`INSERT INTO artifacts (id, workspace_id, owner_id, description) VALUES (?, 'wsp', 'usr', ?)`)
    .bind(id, opts.description ?? null).run();
  await e.DB.prepare(`INSERT INTO deployments (id, artifact_id, version_id, channel) VALUES (?, ?, ?, 'production')`)
    .bind('dep_' + id, id, 'ver_' + id).run();
  await e.DB.prepare(`INSERT INTO versions (id, artifact_id, entrypoint) VALUES (?, ?, 'index.html')`)
    .bind('ver_' + id, id).run();
  await e.DB.prepare(`INSERT INTO assets (id, version_id, path, r2_key, mime) VALUES (?, ?, 'index.html', ?, 'text/html')`)
    .bind('ast_' + id, 'ver_' + id, 'k/' + id).run();
  await e.ARTIFACTS.put('k/' + id, new TextEncoder().encode(opts.html ?? '<html><body>Revenue dashboard</body></html>'));
}

const artifactOf = async (id: string) =>
  e.DB.prepare(
    `SELECT a.description, p.auto_summary_hash
       FROM artifacts a LEFT JOIN artifact_presentation p ON p.artifact_id = a.id
      WHERE a.id = ?`
  ).bind(id)
    .first<{ description: string | null; auto_summary_hash: string | null }>();

const tagsOf = async (id: string) =>
  (await e.DB.prepare('SELECT label FROM artifact_tags WHERE artifact_id = ? ORDER BY label').bind(id).all<{ label: string }>()).results.map(r => r.label);

beforeEach(async () => {
  chatComplete.mockClear();
  await e.DB.exec(`DELETE FROM artifacts`);
  await e.DB.exec(`DELETE FROM deployments`);
  await e.DB.exec(`DELETE FROM versions`);
  await e.DB.exec(`DELETE FROM assets`);
  await e.DB.exec(`DELETE FROM artifact_tags`);
  await e.DB.exec(`DELETE FROM ai_usage_events`);
});

describe('generateArtifactSummary (post-publish, background)', () => {
  it('writes summary into description and tags into artifact_tags, and records usage', async () => {
    await seedArtifact('a1');
    await generateArtifactSummary(e, 'a1');

    const row = await artifactOf('a1');
    expect(row!.description).toBe('A dashboard of quarterly revenue.');
    expect(row!.auto_summary_hash).toBeTruthy();
    expect(await tagsOf('a1')).toEqual(['dashboard', 'q3', 'revenue']); // lowercased, sorted

    const usage = await e.DB.prepare(`SELECT COUNT(*) AS n FROM ai_usage_events WHERE kind='artifact_summary'`).first<{ n: number }>();
    expect(usage!.n).toBe(1);
  });

  it('does not clobber a user-set description', async () => {
    await seedArtifact('a2', { description: 'My hand-written blurb' });
    await generateArtifactSummary(e, 'a2');
    expect((await artifactOf('a2'))!.description).toBe('My hand-written blurb');
    expect(await tagsOf('a2')).toEqual(['dashboard', 'q3', 'revenue']); // tags still populated
  });

  it('dedupes by content hash: re-running on unchanged HTML skips the LLM call', async () => {
    await seedArtifact('a3');
    await generateArtifactSummary(e, 'a3');
    expect(chatComplete).toHaveBeenCalledTimes(1);
    await generateArtifactSummary(e, 'a3');
    expect(chatComplete).toHaveBeenCalledTimes(1); // no second call — hash unchanged
  });

  it('re-summarizes when the HTML content changes', async () => {
    await seedArtifact('a4');
    await generateArtifactSummary(e, 'a4');
    const firstHash = (await artifactOf('a4'))!.auto_summary_hash;

    await e.ARTIFACTS.put('k/a4', new TextEncoder().encode('<html><body>Totally different page</body></html>'));
    await generateArtifactSummary(e, 'a4');

    expect(chatComplete).toHaveBeenCalledTimes(2);
    expect((await artifactOf('a4'))!.auto_summary_hash).not.toBe(firstHash);
  });
});
