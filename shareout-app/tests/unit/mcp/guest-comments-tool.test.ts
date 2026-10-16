// set_guest_comments over MCP runs the same gates as REST: the comments _config PUT
// (artifact owner only) and the folder's guest-comments switch (folder manager).
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { generateToken, hashToken } from '../../../src/api-auth';
import { callTool } from '../../../src/mcp/tools';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';

const env = { ...baseEnv, SESSION_SECRET: 'mcp-guest-secret' } as typeof baseEnv;
const WS = 'wsp_mcpg';
const u = (id: string, email: string): AuthUser => ({ id, email, username: null });
const owner = u('usr_mcpg_owner', 'owner@example.com');
const member = u('usr_mcpg_member', 'member@example.com');
const tokens: Record<string, string> = {};

const call = (user: AuthUser, args: Record<string, unknown>) =>
  callTool({ env, user, origin: 'https://shareout.test', authorization: `Bearer ${tokens[user.id]}` }, 'set_guest_comments', args).then((r) => r!);

beforeAll(async () => {
  await applyMigrations();
  await env.DB.batch([
    ...[owner, member].map((x) => env.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(x.id, x.email, x.email!.split('@')[0])),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-mcpg', ?)").bind(WS, owner.id),
    env.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_mcpg1', ?, ?, 'owner', 'internal'), ('wm_mcpg2', ?, ?, 'member', 'internal')")
      .bind(WS, owner.id, WS, member.id),
    env.DB.prepare("INSERT INTO folders (id, workspace_id, name, slug, created_by) VALUES ('fld_mcpg', ?, 'Client review', 'client-review', ?)").bind(WS, owner.id),
    env.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, folder_id) VALUES ('art_mcpg', ?, 'Proposal', 'mcpg-proposal', 'public', ?, 'fld_mcpg')").bind(owner.id, WS),
  ]);
  for (const x of [owner, member]) {
    tokens[x.id] = generateToken();
    await env.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, 'mcp:Claude')")
      .bind(`tok_${x.id}`, x.id, x.id, await hashToken(tokens[x.id])).run();
  }
});

describe('set_guest_comments', () => {
  it('lets the owner switch a page and refuses anyone else', async () => {
    const denied = await call(member, { artifact_id: 'art_mcpg', enabled: true });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain('Only the page');
    const ok = await call(owner, { artifact_id: 'art_mcpg', enabled: true });
    expect(ok.isError).toBeUndefined();
    expect(ok.structuredContent).toMatchObject({ guest_comments: true, effective: true });
    const follow = await call(owner, { artifact_id: 'art_mcpg', enabled: null });
    expect(follow.structuredContent).toMatchObject({ guest_comments: null, effective: false });
  });

  it('a folder needs its manager, and the setting then reaches the page', async () => {
    const denied = await call(member, { folder: 'Client review', enabled: true });
    expect(denied.isError).toBe(true);
    const ok = await call(owner, { folder: 'Client review', enabled: true });
    expect(ok.isError).toBeUndefined();
    const row = await env.DB.prepare("SELECT guest_comments_enabled AS g FROM folders WHERE id = 'fld_mcpg'").first<{ g: number }>();
    expect(row?.g).toBe(1);
    const page = await call(owner, { artifact_id: 'art_mcpg', enabled: null });
    expect(page.structuredContent).toMatchObject({ effective: true });
  });

  it('rejects a bad enabled value without changing anything', async () => {
    for (const args of [{ folder: 'Client review', enabled: 'yes' }, { folder: 'Client review' }, { folder: 'Client review', enabled: null }]) {
      expect((await call(owner, args)).isError).toBe(true);
    }
  });
});
