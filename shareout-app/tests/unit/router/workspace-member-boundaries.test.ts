// Member-level boundaries inside one workspace: moving a teammate's artifact into a
// folder, the workspace record an external member sees, and connecting a provider on
// an artifact the caller does not own.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleFetch } from '../../../src/router/handle-fetch';
import { hashToken } from '../../../src/api-auth';

const WS = 'wsp_mb_a';
const OWNER = 'usr_mb_owner';
const MEMBER = 'usr_mb_member';
const AUTHOR = 'usr_mb_author';
const EXTERNAL = 'usr_mb_external';
const ART = 'art_mb_private';
const PUBLIC_ART = 'art_mb_public';
const FOLDER = 'fld_mb_shared';
const tok = (c: string) => 'so_' + c.repeat(64);
const TOK: Record<string, string> = { [OWNER]: tok('4'), [MEMBER]: tok('5'), [AUTHOR]: tok('6'), [EXTERNAL]: tok('7') };

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name) VALUES (?, 'o@example.com', 'o'), (?, 'm@example.com', 'm'), (?, 'a@example.com', 'a'), (?, 'x@example.org', 'x')`)
      .bind(OWNER, MEMBER, AUTHOR, EXTERNAL),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id, allowed_emails, context_entry) VALUES (?, 'A', 'mb-a', ?, 'staff@example.com', 'internal guidance')")
      .bind(WS, OWNER),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_mb_1', ?, ?, 'owner', 'internal'), ('wm_mb_2', ?, ?, 'member', 'internal'),
      ('wm_mb_3', ?, ?, 'member', 'internal'), ('wm_mb_4', ?, ?, 'admin', 'external')`)
      .bind(WS, OWNER, WS, MEMBER, WS, AUTHOR, WS, EXTERNAL),
    e.DB.prepare("INSERT INTO folders (id, workspace_id, owner_id, name, slug, created_by) VALUES (?, ?, ?, 'Shared', 'shared', ?)")
      .bind(FOLDER, WS, OWNER, OWNER),
    e.DB.prepare(`INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES
      (?, ?, 'Draft', 'mb-draft', 'private', ?), (?, ?, 'Open', 'mb-open', 'public', ?)`)
      .bind(ART, AUTHOR, WS, PUBLIC_ART, AUTHOR, WS),
  ]);
  for (const [uid, t] of Object.entries(TOK)) {
    await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash) VALUES (?, 'user', ?, ?, ?)")
      .bind(`tok_${uid}`, uid, uid, await hashToken(t)).run();
  }
});

const call = (uid: string | null, method: string, path: string, body?: unknown) =>
  handleFetch(new Request(`https://shareout.test${path}`, {
    method,
    headers: { ...(uid ? { Authorization: `Bearer ${TOK[uid]}` } : {}), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), e);

const folderOf = async () => (await e.DB.prepare('SELECT folder_id FROM artifacts WHERE id = ?').bind(ART).first<{ folder_id: string | null }>())?.folder_id;

describe('moving an artifact into a folder', () => {
  const move = (uid: string, folder: string | null) => call(uid, 'POST', `/v1/workspaces/${WS}/artifacts/${ART}/move`, { folder_id: folder });

  it('refuses a member who neither owns nor edits it', async () => {
    expect((await move(MEMBER, FOLDER)).status).toBe(403);
    expect(await folderOf()).toBeNull();
  });

  it('refuses an external member', async () => {
    expect((await move(EXTERNAL, FOLDER)).status).toBe(403);
    expect(await folderOf()).toBeNull();
  });

  it('lets the author and a workspace admin move it', async () => {
    expect((await move(AUTHOR, FOLDER)).status).toBe(200);
    expect(await folderOf()).toBe(FOLDER);
    expect((await move(OWNER, null)).status).toBe(200);
    expect(await folderOf()).toBeNull();
  });
});

describe('the workspace record', () => {
  it('shows an external member only who the workspace is', async () => {
    const res = await call(EXTERNAL, 'GET', `/v1/workspaces/${WS}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ id: WS, slug: 'mb-a', member_class: 'external' });
    expect(body).not.toHaveProperty('allowed_emails');
    expect(body).not.toHaveProperty('context_entry');
    expect(body).not.toHaveProperty('member_count');
  });

  it('shows internal members the full record', async () => {
    const body = await (await call(MEMBER, 'GET', `/v1/workspaces/${WS}`)).json() as Record<string, unknown>;
    expect(body.allowed_emails).toBe('staff@example.com');
    expect(body.member_count).toBe(4);
  });
});

describe('connecting a provider on an artifact', () => {
  it('refuses anyone but the owner, and an unsigned callback', async () => {
    for (const uid of [null, MEMBER]) {
      const res = await call(uid, 'GET', `/v1/data/${PUBLIC_ART}/platform/google-sheets/auth-url?connection=main`);
      expect(res.status, String(uid)).toBe(403);
    }
    const state = btoa(JSON.stringify({ artifactId: PUBLIC_ART, connectionName: 'main', returnUrl: '' }));
    const cb = await call(null, 'GET', `/v1/data/${PUBLIC_ART}/platform/google-sheets/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(await cb.text()).toMatch(/Invalid state/);
    const rows = await e.DB.prepare('SELECT COUNT(*) AS n FROM connections WHERE scope_id = ?').bind(PUBLIC_ART).first<{ n: number }>();
    expect(rows?.n ?? 0).toBe(0);
  });
});
