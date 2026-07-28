// Drip backfill of auto-summaries for pre-existing artifacts. generateArtifactSummary
// itself is covered in auto-summary.test.ts — this only pins the candidate selection
// (empty description + null hash, html, not deleted, LIMIT, freshest-first) and that
// one artifact's failure doesn't stop the rest of the run.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';

const generateArtifactSummary = vi.fn(async () => {});
vi.mock('../../../src/publish/auto-summary', () => ({
  generateArtifactSummary: (...a: unknown[]) => generateArtifactSummary(...a),
}));

const { runSummaryBackfill } = await import('../../../src/publish/summary-backfill');

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, description TEXT, deleted_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifact_presentation (artifact_id TEXT PRIMARY KEY, social_title TEXT, social_description TEXT, social_image_url TEXT, thumbnail_ext TEXT, thumbnail_generated_at TEXT, pwa_config TEXT, has_mobile INTEGER NOT NULL DEFAULT 0, embed_allowed INTEGER NOT NULL DEFAULT 1, embed_origins TEXT, editor_readiness TEXT, auto_summary_hash TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, artifact_id TEXT, version_id TEXT, channel TEXT, updated_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, artifact_id TEXT, entrypoint TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, version_id TEXT, path TEXT, mime TEXT)`);
});

beforeEach(async () => {
  generateArtifactSummary.mockClear();
  await e.DB.exec('DELETE FROM artifacts');
  await e.DB.exec('DELETE FROM deployments');
  await e.DB.exec('DELETE FROM versions');
  await e.DB.exec('DELETE FROM assets');
});

async function seedArtifact(id: string, opts: {
  description?: string | null;
  hash?: string | null;
  deletedAt?: string | null;
  mime?: string;
  publishedAt?: string;
} = {}) {
  await e.DB.prepare('INSERT INTO artifacts (id, description, deleted_at) VALUES (?, ?, ?)')
    .bind(id, opts.description ?? null, opts.deletedAt ?? null).run();
  if (opts.hash !== undefined && opts.hash !== null) {
    await e.DB.prepare('INSERT INTO artifact_presentation (artifact_id, auto_summary_hash) VALUES (?, ?)')
      .bind(id, opts.hash).run();
  }
  await e.DB.prepare('INSERT INTO deployments (id, artifact_id, version_id, channel, updated_at) VALUES (?, ?, ?, \'production\', ?)')
    .bind('dep_' + id, id, 'ver_' + id, opts.publishedAt ?? '2026-01-01 00:00:00').run();
  await e.DB.prepare('INSERT INTO versions (id, artifact_id, entrypoint) VALUES (?, ?, \'index.html\')')
    .bind('ver_' + id, id).run();
  await e.DB.prepare('INSERT INTO assets (id, version_id, path, mime) VALUES (?, ?, \'index.html\', ?)')
    .bind('ast_' + id, 'ver_' + id, opts.mime ?? 'text/html').run();
}

describe('runSummaryBackfill', () => {
  it('processes only html artifacts with empty description and null hash', async () => {
    await seedArtifact('needs_summary');
    await seedArtifact('has_description', { description: 'Already set' });
    await seedArtifact('has_hash', { hash: 'abc123' });
    await seedArtifact('deleted', { deletedAt: '2026-01-01' });
    await seedArtifact('not_html', { mime: 'text/csv' });

    const result = await runSummaryBackfill(e);

    expect(result.processed).toBe(1);
    expect(generateArtifactSummary).toHaveBeenCalledTimes(1);
    expect(generateArtifactSummary).toHaveBeenCalledWith(e, 'needs_summary');
  });

  it('orders most recently published first and respects the 25 LIMIT', async () => {
    for (let i = 0; i < 30; i++) {
      await seedArtifact(`art_${i}`, { publishedAt: `2026-01-${String(i + 1).padStart(2, '0')} 00:00:00` });
    }

    const result = await runSummaryBackfill(e);

    expect(result.processed).toBe(25);
    expect(generateArtifactSummary).toHaveBeenCalledTimes(25);
    // freshest (highest day number) processed first
    expect(generateArtifactSummary).toHaveBeenNthCalledWith(1, e, 'art_29');
  });

  it('one failing artifact does not stop the rest of the run', async () => {
    await seedArtifact('fails');
    await seedArtifact('succeeds');
    generateArtifactSummary.mockImplementationOnce(async () => { throw new Error('network blip'); });

    const result = await runSummaryBackfill(e);

    expect(result.processed).toBe(2);
    expect(generateArtifactSummary).toHaveBeenCalledTimes(2);
  });

  it('is a cheap no-op when the backlog is empty', async () => {
    await seedArtifact('already_done', { description: 'Set' });

    const result = await runSummaryBackfill(e);

    expect(result.processed).toBe(0);
    expect(generateArtifactSummary).not.toHaveBeenCalled();
  });
});
