// A page imported private is skipped by the distiller. When its owner later shares it with the
// workspace, it is queued again so it gets a Knowledge note like every other shared page — and
// the same holds every time it goes private and comes back.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { AuthUser } from '../../../src/api-auth';
import type { Env } from '../../../src/types';
import { getKnowledgeFile, runKnowledgeDistill } from '../../../src/knowledge';
import { handleUpdateArtifact } from '../../../src/artifacts/crud';

const WS = 'wsp_relearn';
const OWNER = 'usr_relearn_owner';
const ID = 'art_relearn';
const owner: AuthUser = { id: OWNER, email: 'owner@example.test', username: null };
const denv = { ...e, ARTIFACTS: { get: async () => ({ text: async () => '<p>Registro de documentos vigentes</p>' }) } } as unknown as Env;
const complete = async () => '{"title":"Registro","topics":["documentos"],"entities":[],"summary":"s"}\n\nLista de documentos vigentes.';

const setVisibility = (visibility: string) =>
  handleUpdateArtifact(
    new Request(`https://shareout.example.com/v1/artifacts/${ID}`, { method: 'PATCH', body: JSON.stringify({ visibility }) }),
    e, owner, ID,
  );
const sharedRow = () =>
  e.DB.prepare("SELECT content_hash, processed_at FROM knowledge_ingest WHERE workspace_id = ? AND artifact_id = ? AND reason = 'shared'")
    .bind(WS, ID).first<{ content_hash: string | null; processed_at: string | null }>();
const digest = () => getKnowledgeFile(e, WS, `artifacts/${ID}.md`);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'owner@example.test', 'Owner')").bind(OWNER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'relearn-w', ?)").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_relearn', ?, ?, 'owner')").bind(WS, OWNER),
    e.DB.prepare('INSERT INTO knowledge_settings (workspace_id, enabled) VALUES (?, 1)').bind(WS),
  ]);
});

beforeEach(async () => {
  await e.DB.prepare("DELETE FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge'").bind(WS).run();
  await e.DB.prepare('DELETE FROM knowledge_ingest WHERE workspace_id = ?').bind(WS).run();
  await e.DB.prepare('DELETE FROM assets WHERE version_id = ?').bind(`ver_${ID}`).run();
  await e.DB.prepare('DELETE FROM deployments WHERE artifact_id = ?').bind(ID).run();
  await e.DB.prepare('DELETE FROM versions WHERE artifact_id = ?').bind(ID).run();
  await e.DB.prepare('DELETE FROM artifacts WHERE id = ?').bind(ID).run();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Registro', 'registro', ?, ?, 'private')").bind(ID, OWNER, WS),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, 'index.html', '{}')").bind(`ver_${ID}`, ID),
  ]);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', 'registro')").bind(`dep_${ID}`, ID, `ver_${ID}`),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', 'relearn/index', 'text/html', 5, 'x')").bind(`ast_${ID}`, `ver_${ID}`),
    // Published while private: queued, then skipped by the distiller.
    e.DB.prepare("INSERT INTO knowledge_ingest (workspace_id, artifact_id, content_hash, reason) VALUES (?, ?, ?, 'publish')").bind(WS, ID, `ver_${ID}`),
  ]);
  await runKnowledgeDistill(denv, { complete });
  expect(await digest()).toBeNull();
});

describe('a private page shared with the workspace', () => {
  it('is queued for the live version and gets its Knowledge note', async () => {
    expect((await setVisibility('workspace')).status).toBe(200);
    expect(await sharedRow()).toEqual({ content_hash: `ver_${ID}`, processed_at: null });

    await runKnowledgeDistill(denv, { complete });
    expect((await digest())?.content).toContain('Lista de documentos vigentes.');
  });

  it('made private and shared again: learned again', async () => {
    await setVisibility('workspace');
    await runKnowledgeDistill(denv, { complete });
    expect(await digest()).not.toBeNull();

    await setVisibility('private');
    expect(await digest()).toBeNull();
    expect(await sharedRow()).toBeNull();

    await setVisibility('workspace');
    await runKnowledgeDistill(denv, { complete });
    expect(await digest()).not.toBeNull();
  });

  it('a change between shared visibilities queues nothing', async () => {
    await e.DB.prepare("UPDATE artifacts SET visibility = 'workspace' WHERE id = ?").bind(ID).run();
    expect((await setVisibility('workspace')).status).toBe(200);
    expect(await sharedRow()).toBeNull();
  });
});
