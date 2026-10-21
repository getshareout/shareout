// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { runKnowledgeDistill, listKnowledgeFiles } from '../../../src/knowledge';
import type { Env } from '../../../src/types';

const WS = 'wsp_f42';
const denv = { ...e, ARTIFACTS: { get: async () => ({ text: async () => '<p>Secret roadmap content</p>' }) } } as unknown as Env;

async function seed(id: string, visibility: string) {
  await e.DB.batch([
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, ?, ?, ?, ?, ?)').bind(id, id, `slug-${id}`, 'usr_f42_o', WS, visibility),
    e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, ?)').bind(`ver_${id}`, id, 'index.html', '{}'),
  ]);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, `ver_${id}`, `slug-${id}`),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', 5, 'x')").bind(`ast_${id}`, `ver_${id}`, `f42/${id}`),
    e.DB.prepare("INSERT INTO knowledge_ingest (workspace_id, artifact_id, content_hash, reason) VALUES (?, ?, 'v1', 'publish')").bind(WS, id),
  ]);
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f42_o','f42@example.test','o')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f42-w', 'usr_f42_o')").bind(WS),
    e.DB.prepare('INSERT INTO knowledge_settings (workspace_id, enabled) VALUES (?, 1)').bind(WS),
  ]);
  await seed('art_f42_priv', 'private');
  await seed('art_f42_ws', 'workspace');
});

describe('f42 knowledge digests', () => {
  it('blocks: private pages are not digested into shared workspace notes; others still are', async () => {
    const complete = async () => '{"title":"T","topics":["x"],"entities":[],"summary":"s"}\n\nSummary of the secret roadmap.';
    await runKnowledgeDistill(denv, { complete });
    const paths = (await listKnowledgeFiles(e, WS)).map((f) => f.path);
    expect(paths.some((p) => p.includes('art_f42_priv'))).toBe(false);
    expect(paths.some((p) => p.includes('art_f42_ws'))).toBe(true);
  });
});
