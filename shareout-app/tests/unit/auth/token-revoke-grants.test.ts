// Revoking or regenerating personal tokens also revokes the connected-app grants that
// could mint a new access token, against the real schema.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleCreateMyToken, handleRevokeMyToken } from '../../../src/api-me-tokens';
import { handleRevokeMemberTokens } from '../../../src/workspaces-tokens';

const USER = { id: 'usr_tg_a', email: 'a@example.com', username: null };
const OTHER = 'usr_tg_b';

async function grant(id: string, userId: string, tokenId: string | null) {
  await e.DB.prepare(
    "INSERT INTO oauth_grants (id, client_id, user_id, refresh_token_hash, access_token_id, expires_at) VALUES (?, 'cli_tg', ?, ?, ?, '2999-01-01T00:00:00.000Z')",
  ).bind(id, userId, `rt_${id}`, tokenId).run();
}
const revoked = async (id: string) =>
  !!(await e.DB.prepare('SELECT revoked_at FROM oauth_grants WHERE id = ?').bind(id).first<{ revoked_at: string | null }>())?.revoked_at;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'a@example.com', 'a'), (?, 'b@example.com', 'b')").bind(USER.id, OTHER),
    e.DB.prepare("INSERT INTO oauth_clients (id, client_name, redirect_uris) VALUES ('cli_tg', 'app', '[]')"),
    e.DB.prepare(`INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES
      ('tok_tg_1', 'user', ?, ?, 'h_tg_1', 'mcp:app'), ('tok_tg_2', 'user', ?, ?, 'h_tg_2', 'mcp:app'), ('tok_tg_3', 'user', ?, ?, 'h_tg_3', 'mcp:app')`)
      .bind(USER.id, USER.id, USER.id, USER.id, OTHER, OTHER),
  ]);
  await grant('grt_tg_1', USER.id, 'tok_tg_1');
  await grant('grt_tg_2', USER.id, 'tok_tg_2');
  await grant('grt_tg_3', OTHER, 'tok_tg_3');
});

describe('token revocation and connected-app grants', () => {
  it('revoking one token revokes only the grant holding it', async () => {
    expect((await handleRevokeMyToken(e, USER, 'tok_tg_1')).status).toBe(200);
    expect(await revoked('grt_tg_1')).toBe(true);
    expect(await revoked('grt_tg_2')).toBe(false);
    expect(await revoked('grt_tg_3')).toBe(false);
  });

  it('regenerating revokes all of the caller\'s grants and no one else\'s', async () => {
    const res = await handleCreateMyToken(new Request('https://x/v1/me/tokens', { method: 'POST', body: '{"regenerate":true}' }), e, USER);
    expect(res.status).toBe(200);
    expect(await revoked('grt_tg_2')).toBe(true);
    expect(await revoked('grt_tg_3')).toBe(false);
  });

  it('an admin revoking a member\'s tokens also revokes that member\'s grants', async () => {
    await e.DB.batch([
      e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('wsp_tg', 'W', 'tg-w', ?)").bind(USER.id),
      e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_tg_1', 'wsp_tg', ?, 'owner', 'internal'), ('wm_tg_2', 'wsp_tg', ?, 'member', 'internal')").bind(USER.id, OTHER),
    ]);
    const res = await handleRevokeMemberTokens(new Request('https://x', { method: 'DELETE' }), e, USER, 'wsp_tg', OTHER);
    expect(res.status).toBe(200);
    expect(await revoked('grt_tg_3')).toBe(true);
    expect(await e.DB.prepare("SELECT COUNT(*) AS n FROM tokens WHERE user_id = ?").bind(OTHER).first<{ n: number }>()).toEqual({ n: 0 });
  });
});
