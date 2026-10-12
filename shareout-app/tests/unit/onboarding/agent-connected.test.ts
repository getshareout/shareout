// @vitest-environment node
// "Connect your agent" is ticked only by a real connection: a key the person's own
// agent has actually used (MCP connector, device login, personal key). An admin-issued
// key, a key minted but never used, or a revoked one must not tick it.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { getOnboardingStatus } from '../../../src/onboarding/status';

const WS = 'wsp_agentconn';
const OWNER = 'usr_ac_owner';
const MEMBER = 'usr_ac_member';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(OWNER, 'owner@ac.test', 'Owner'),
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(MEMBER, 'laura@ac.test', 'Laura'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'AC', 'ac-ws', OWNER),
    e.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')").bind(WS, MEMBER),
  ]);
});

beforeEach(async () => { await e.DB.prepare('DELETE FROM tokens WHERE user_id = ?').bind(MEMBER).run(); });

let n = 0;
async function token(name: string, opts: { used?: boolean; revoked?: boolean } = {}) {
  n++;
  await e.DB.prepare(
    `INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name, last_used_at, revoked_at)
     VALUES (?, 'user', ?, ?, ?, ?, ?, ?)`
  ).bind(`tok_ac_${n}`, MEMBER, MEMBER, `hash_ac_${n}`, name,
    opts.used ? new Date().toISOString() : null, opts.revoked ? new Date().toISOString() : null).run();
}

async function connected(): Promise<boolean | undefined> {
  const s = await getOnboardingStatus(e, WS, MEMBER);
  return s?.tasks.find((t) => t.key === 'connect_agent')?.done;
}

describe('connect_agent onboarding signal', () => {
  it('is not done with no keys', async () => {
    expect(await connected()).toBe(false);
  });

  it('is not done for a key an admin minted for the member, even once used', async () => {
    await token('admin-issued', { used: true });
    expect(await connected()).toBe(false);
  });

  it('is not done for a key that was created but never used', async () => {
    await token('default');
    expect(await connected()).toBe(false);
  });

  it('is not done for a revoked key', async () => {
    await token('mcp:Claude', { used: true, revoked: true });
    expect(await connected()).toBe(false);
  });

  it('is done once a connected agent has used its key', async () => {
    await token('mcp:Claude', { used: true });
    expect(await connected()).toBe(true);
  });
});
