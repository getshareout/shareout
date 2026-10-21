import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { publishConversation } from '../../../src/data/agent/admin-chat';
import type { DataContext } from '../../../src/data/middleware';

const ART = 'art_h5pub';

beforeAll(async () => {
  await applyMigrations();
  await e.ARTIFACTS.put(`artifacts/${ART}/ver_h5_1/index.html`, '<h1>Old</h1>');
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_h5_owner', 'owner@example.test'), ('usr_h5_editor', 'editor@example.test')"),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'P', 'h5-pub', 'usr_h5_owner', 'private')").bind(ART),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_by) VALUES ('ver_h5_1', ?, 1, 'index.html', '{}', 'usr_h5_owner')").bind(ART),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES ('ast_h5_1', 'ver_h5_1', 'index.html', ?, 'text/html', 12, 'x')").bind(`artifacts/${ART}/ver_h5_1/index.html`),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, slug) VALUES ('dep_h5', ?, 'ver_h5_1', 'h5-pub')").bind(ART),
    e.DB.prepare("INSERT INTO agent_threads (id, scope_type, scope_key, user_id) VALUES ('thr_h5', 'artifact_admin', ?, 'usr_h5_editor')").bind(ART),
    e.DB.prepare("INSERT INTO artifact_pending_edits (id, artifact_id, thread_id, file_path, original_content, new_content) VALUES ('pe_h5', ?, 'thr_h5', 'index.html', '<h1>Old</h1>', '<h1>New</h1>')").bind(ART),
  ]);
});

describe('chat publish writes a complete version row', () => {
  it('publishes with the previous entrypoint and records the publisher', async () => {
    const ctx = { env: e, artifactId: ART, artifact: { owner_id: 'usr_h5_owner' }, origin: null } as unknown as DataContext;
    const res = await publishConversation(ctx, 'thr_h5', 'edit', 'usr_h5_editor');
    expect(res.ok).toBe(true);
    const v = await e.DB.prepare('SELECT entrypoint, created_by FROM versions WHERE artifact_id = ? AND version_no = 2').bind(ART).first<{ entrypoint: string; created_by: string }>();
    expect(v).toEqual({ entrypoint: 'index.html', created_by: 'usr_h5_editor' });
  });
});
