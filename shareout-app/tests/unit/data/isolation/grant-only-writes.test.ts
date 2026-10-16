// A viewer whose access to a closed artifact rests on a grant writes only with an edit
// grant, whether they arrive with a viewer token or a session cookie.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../../helpers/migrated-db';
import { createAccessToken, createSessionToken } from '../../../../src/token';
import { dataMiddleware } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';

const env = { ...e, SESSION_SECRET: 'test-session-secret' } as Env;
const WS = 'wsp_gow';
const OWNER = 'usr_gow_owner';
const VIEW_GUEST = 'usr_gow_view';
const EDIT_GUEST = 'usr_gow_edit';
const MEMBER = 'usr_gow_member';
const ART = 'art_gow_private';
const ART_WS = 'art_gow_ws';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name) VALUES
      (?, 'owner@example.com', 'o'), (?, 'view@example.com', 'v'), (?, 'edit@example.com', 'e'), (?, 'member@example.com', 'm')`)
      .bind(OWNER, VIEW_GUEST, EDIT_GUEST, MEMBER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'gow', ?)").bind(WS, OWNER),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_gow1', ?, ?, 'owner', 'internal'), ('wm_gow2', ?, ?, 'member', 'external'),
      ('wm_gow3', ?, ?, 'member', 'external'), ('wm_gow4', ?, ?, 'member', 'internal')`)
      .bind(WS, OWNER, WS, VIEW_GUEST, WS, EDIT_GUEST, WS, MEMBER),
    e.DB.prepare(`INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, auth_method) VALUES
      (?, ?, 'P', 'gow-private', 'private', ?, 'google'), (?, ?, 'W', 'gow-ws', 'workspace', ?, 'google')`)
      .bind(ART, OWNER, WS, ART_WS, OWNER, WS),
    e.DB.prepare(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES
      ('gr_gow1', ?, 'external_user', ?, 'artifact', ?, 'view', ?), ('gr_gow2', ?, 'external_user', ?, 'artifact', ?, 'edit', ?)`)
      .bind(WS, VIEW_GUEST, ART, OWNER, WS, EDIT_GUEST, ART, OWNER),
  ]);
});

async function viaViewerToken(artifactId: string, email: string) {
  const token = await createAccessToken(artifactId, 'viewer', env, 3600, email);
  return dataMiddleware(new Request(`https://shareout.test/v1/data/${artifactId}/json/x`, { headers: { Authorization: `Bearer ${token}` } }), env, artifactId);
}

async function viaSession(artifactId: string, userId: string, email: string) {
  const token = await createSessionToken(userId, email, env);
  return dataMiddleware(new Request(`https://shareout.test/v1/data/${artifactId}/json/x`, { headers: { Cookie: `shareout_session=${token}` } }), env, artifactId);
}

const canWrite = (ctx: unknown) => (ctx as { canWrite?: boolean }).canWrite;

describe('grant-only viewers and writes', () => {
  it('a view grant is read-only through a viewer token and a session', async () => {
    expect(canWrite(await viaViewerToken(ART, 'view@example.com'))).toBe(false);
    expect(canWrite(await viaSession(ART, VIEW_GUEST, 'view@example.com'))).toBe(false);
  });

  it('an edit grant can write', async () => {
    expect(canWrite(await viaViewerToken(ART, 'edit@example.com'))).toBe(true);
    expect(canWrite(await viaSession(ART, EDIT_GUEST, 'edit@example.com'))).toBe(true);
  });

  it('an internal member of a workspace-visible artifact keeps write capability', async () => {
    expect(canWrite(await viaViewerToken(ART_WS, 'member@example.com'))).toBe(true);
    expect(canWrite(await viaSession(ART_WS, MEMBER, 'member@example.com'))).toBe(true);
  });
});
