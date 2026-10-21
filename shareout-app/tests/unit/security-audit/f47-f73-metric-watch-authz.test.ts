// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { createWatch, deleteWatch, listWatches } from '../../../src/metric-watch/watches';
import { applyMigrations, e } from '../helpers/migrated-db';

const WS = 'wsp_f47';
const OPEN = 'art_f47_open';
const POLICY_ART = 'art_f47_policy';
const POLICY = JSON.stringify({ version: 1, field: 'tenant', rules: [{ match: { email: 'f47a@x.test' }, values: ['A'] }], default: 'deny' });
const owner = { id: 'usr_f47_owner', email: 'f47owner@x.test' };
const memberA = { id: 'usr_f47_a', email: 'f47a@x.test' };
const memberB = { id: 'usr_f47_b', email: 'f47b@x.test' };
const spec = { table: 'T', kind: 'count' as const };

const seedTable = async (art: string) => {
  const token = await createSessionToken(owner.id, owner.email, e);
  const res = await handleDataRequest(
    new Request(`https://so.test/v1/data/${art}/tables/T`, { method: 'POST', headers: { Cookie: `shareout_session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant: 'A', n: 1 }) }),
    e, `${art}/tables/T`);
  expect(res.status).toBeLessThan(300);
};

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f47';
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?), (?, ?), (?, ?)').bind(owner.id, owner.email, memberA.id, memberA.email, memberB.id, memberB.email),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f47-w', ?)").bind(WS, owner.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f47o', ?, ?, 'owner', 'internal'), ('wm_f47a', ?, ?, 'member', 'internal'), ('wm_f47b', ?, ?, 'member', 'internal')")
      .bind(WS, owner.id, WS, memberA.id, WS, memberB.id),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'open', 'f47-open', ?, ?, 'workspace')").bind(OPEN, owner.id, WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, access_policy) VALUES (?, 'pol', 'f47-pol', ?, ?, 'workspace', ?)").bind(POLICY_ART, owner.id, WS, POLICY),
  ]);
  await seedTable(OPEN);
  await seedTable(POLICY_ART);
});

describe('f47 metric watch deletion', () => {
  it('blocks: a plain member cannot delete a watch someone else created; the creator and the owner can', async () => {
    const made = await createWatch(e, owner.id, OPEN, spec);
    expect(made.error).toBeUndefined();
    const id = made.watch!.id;

    expect((await deleteWatch(e, memberB.id, id)).success).toBe(false);
    expect((await listWatches(e, owner.id, OPEN)).watches).toHaveLength(1);

    const mine = await createWatch(e, memberB.id, OPEN, { table: 'T', kind: 'sum', column: 'n' });
    expect(mine.error).toBeUndefined();
    expect((await deleteWatch(e, memberB.id, mine.watch!.id)).success).toBe(true);
    expect((await deleteWatch(e, owner.id, id)).success).toBe(true);
  });
});

describe('f73 metric watch on a row-policy artifact', () => {
  it('blocks: a row-restricted member cannot create a whole-table aggregate watch; the owner can', async () => {
    const denied = await createWatch(e, memberA.id, POLICY_ART, spec);
    expect(denied.watch).toBeUndefined();
    expect(denied.error).toMatch(/denied|policy/i);
    const deniedB = await createWatch(e, memberB.id, POLICY_ART, spec);
    expect(deniedB.watch).toBeUndefined();

    const ok = await createWatch(e, owner.id, POLICY_ART, spec);
    expect(ok.error).toBeUndefined();
  });
});
