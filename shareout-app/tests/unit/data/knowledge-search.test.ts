import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';
import type { DataContext } from '../../../src/data/middleware';
import { handleKnowledge } from '../../../src/data/knowledge-search';
import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { setKnowledgeEnabled } from '../../../src/knowledge';
import { createSessionToken } from '../../../src/token';

const e = env as unknown as Env;
const authEnv = { ...e, SESSION_SECRET: 'aks-session-secret' } as Env;
const WS = 'wsp_aks_1';
const OTHER_WS = 'wsp_aks_2';

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS knowledge_ingest (workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL, content_hash TEXT, reason TEXT NOT NULL, queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT, PRIMARY KEY (workspace_id, artifact_id, reason))`,
    `CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, member_class TEXT NOT NULL DEFAULT 'internal', PRIMARY KEY (workspace_id, user_id))`,
  ]) await e.DB.exec(sql);
  await e.DB.batch([
    e.DB.prepare("INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role, member_class) VALUES (?, 'u_member', 'member', 'internal')").bind(WS),
    e.DB.prepare("INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role, member_class) VALUES (?, 'u_owner', 'owner', 'internal')").bind(WS),
    e.DB.prepare("INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role, member_class) VALUES (?, 'u_external', 'member', 'external')").bind(WS),
    e.DB.prepare("INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role, member_class) VALUES (?, 'u_other', 'member', 'internal')").bind(OTHER_WS),
  ]);
  await setKnowledgeEnabled(e, WS, true);
  await setKnowledgeEnabled(e, OTHER_WS, true);
  await putFile(WS, 'dlv_open', 'Inspection periodicity is every six months.');
  await putFile(WS, 'dlv_secret', 'Inspection secret salary bands for engineering.', { owner: 'u_owner', visibility: 'private' });
  await putFile(OTHER_WS, 'dlv_foreign', 'Inspection notes belonging to another workspace.');
});

async function putFile(ws: string, id: string, text: string | Uint8Array, opts: { owner?: string; visibility?: string; filename?: string; mime?: string; version?: number } = {}) {
  const version = opts.version ?? 1;
  const blobId = `blob_${id}_${version}`;
  const key = `test/${blobId}`;
  await e.ARTIFACTS.put(key, text);
  await e.DB.prepare('INSERT OR IGNORE INTO asset_deliverables (id, workspace_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?)')
    .bind(id, ws, opts.owner ?? 'u1', `${id}.md`, opts.visibility ?? 'workspace').run();
  await e.DB.prepare('INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(blobId, opts.filename ?? `${id}.md`, opts.mime ?? 'text/markdown', key, text.length, id, version).run();
  await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: id }, blobId);
}


const cookie = async (userId: string) => `shareout_session=${await createSessionToken(userId, `${userId}@example.com`, authEnv)}`;

async function search(q: string, userId: string | null, ws = WS, extra = '') {
  const headers = new Headers();
  if (userId) headers.set('Cookie', await cookie(userId));
  const request = new Request(`https://example.com/v1/data/art_1/knowledge/search?q=${encodeURIComponent(q)}${extra}`, { headers });
  const ctx = { artifactId: 'art_1', workspaceId: ws, env: authEnv, origin: null, artifact: { workspace_id: ws } } as unknown as DataContext;
  const res = await handleKnowledge(request, ctx, '/search');
  const body = await res.json() as { data?: { hits: { source: { id: string } }[] } };
  return { status: res.status, ids: body.data?.hits.map((h) => h.source.id) ?? [], texts: (body.data?.hits as { text: string }[] | undefined)?.map((h) => h.text) ?? [] };
}

describe('artifact knowledge search', () => {
  it('returns whole passages with full=1 and snippets without it', async () => {
    await putFile(WS, 'dlv_long', `## Inspecciones\n\n${'zebrafish periodicidad anual '.repeat(30)}FINAL-MARKER`);
    const short = await search('zebrafish', 'u_member');
    expect(short.texts[0]).not.toContain('FINAL-MARKER');
    const full = await search('zebrafish', 'u_member', WS, '&full=1');
    expect(full.texts[0]).toContain('FINAL-MARKER');
    expect((await search('zebrafish', null, WS, '&full=1')).status).toBe(401);
  });

  it('returns hits to an internal member', async () => {
    const r = await search('inspection', 'u_member');
    expect(r.status).toBe(200);
    expect(r.ids).toContain('dlv_open');
  });

  it('never returns another member\'s private document, but does for its owner', async () => {
    expect((await search('salary', 'u_member')).ids).toEqual([]);
    expect((await search('salary', 'u_owner')).ids).toEqual(['dlv_secret']);
  });

  it('only searches the artifact\'s own workspace', async () => {
    expect((await search('inspection', 'u_member')).ids).not.toContain('dlv_foreign');
  });

  it('rejects anonymous viewers with 401', async () => {
    expect((await search('inspection', null)).status).toBe(401);
  });

  it('rejects a user who is not a member of the workspace', async () => {
    expect((await search('inspection', 'u_other')).status).toBe(403);
  });

  it('rejects external members', async () => {
    expect((await search('inspection', 'u_external')).status).toBe(403);
  });
});
