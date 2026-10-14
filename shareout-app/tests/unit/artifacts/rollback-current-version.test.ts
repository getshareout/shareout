// Real D1: after a rollback, GET /v1/artifacts/{id} reports the deployed version as
// current_version (and the highest published one as latest_version).
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';
import { handleGetArtifact, handleRollback } from '../../../src/artifacts';

const e = { ...(env as unknown as Env), SHAREOUT_BASE_URL: 'https://shareout.site' } as Env;
const owner: AuthUser = { id: 'usr_rb', email: 'rb@x.com', username: null };

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, username TEXT, name TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, owner_id TEXT, workspace_id TEXT, folder_id TEXT, name TEXT, slug TEXT, display_slug TEXT, visibility TEXT, paused INTEGER DEFAULT 0, created_at TEXT, artifact_type TEXT, description TEXT, auth_method TEXT, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, artifact_id TEXT, version_no INTEGER, entrypoint TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, artifact_id TEXT, channel TEXT, version_id TEXT, slug TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, slug TEXT, locale TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_presentation (artifact_id TEXT PRIMARY KEY, social_title TEXT, social_description TEXT, social_image_url TEXT, thumbnail_ext TEXT, embed_allowed INTEGER, embed_origins TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT, reason TEXT, checked_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS favorites (artifact_id TEXT, user_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS collaborators (artifact_id TEXT, email TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_tags (id TEXT PRIMARY KEY, artifact_id TEXT, label TEXT, UNIQUE(artifact_id, label))`,
  ]) await e.DB.exec(sql);
  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_rb','rb@x.com')`);
  await e.DB.exec(`INSERT INTO artifacts (id, owner_id, name, slug, visibility, created_at, artifact_type, auth_method) VALUES ('art_rb','usr_rb','R','rb','private','2026-01-01T00:00:00Z','html','none')`);
  await e.DB.exec(`INSERT INTO versions (id, artifact_id, version_no, entrypoint, created_at) VALUES ('ver_1','art_rb',1,'index.html','2026-01-01T00:00:00Z'),('ver_2','art_rb',2,'index.html','2026-01-02T00:00:00Z')`);
  await e.DB.exec(`INSERT INTO deployments (id, artifact_id, channel, version_id, slug, updated_at) VALUES ('dep_rb','art_rb','production','ver_2','rb','2026-01-02T00:00:00Z')`);
});

async function detail() {
  const res = await handleGetArtifact(new Request('https://x'), e, owner, 'art_rb');
  return res.json() as Promise<{ current_version: number; latest_version: number }>;
}

describe('rollback reflects in current_version', () => {
  it('reports deployed vs latest version', async () => {
    expect(await detail()).toMatchObject({ current_version: 2, latest_version: 2 });
    const rb = await handleRollback(
      new Request('https://x', { method: 'POST', body: JSON.stringify({ version_no: 1 }) }),
      e, owner, 'art_rb',
    );
    expect(rb.status).toBe(200);
    expect(await detail()).toMatchObject({ current_version: 1, latest_version: 2 });
  });
});
