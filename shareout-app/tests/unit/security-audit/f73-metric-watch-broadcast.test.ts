// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { queryNeedsYou } from '../../../src/pages/home/queries/activity-needs-you';

const POLICY = JSON.stringify({ version: 1, field: 'tenant', rules: [{ match: { email: 'f73a@x.test' }, values: ['A'] }], default: 'deny' });
const users = {
  owner: { id: 'usr_f73_o', email: 'f73o@x.test' },
  editor: { id: 'usr_f73_e', email: 'f73e@x.test' },
  a: { id: 'usr_f73_a', email: 'f73a@x.test' },
  other: { id: 'usr_f73_x', email: 'f73x@x.test' },
};
const WS = 'wsp_f73';

const feed = async (u: { id: string; email: string }) =>
  (await queryNeedsYou(e, u, { workspaceId: WS })).filter((ev) => ev.kind === 'metric_watch').map((ev) => ev.artifact_id);

beforeAll(async () => {
  await applyMigrations();
  const all = Object.values(users);
  await e.DB.batch([
    ...all.map((u) => e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email)),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f73-w', ?)").bind(WS, users.owner.id),
    ...all.map((u, i) => e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES (?, ?, ?, ?, 'internal')")
      .bind(`wm_f73_${i}`, WS, u.id, u === users.owner ? 'owner' : 'member')),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, access_policy) VALUES ('art_f73_pol','p','f73-pol',?,?,'workspace',?)").bind(users.owner.id, WS, POLICY),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES ('art_f73_open','o','f73-open',?,?,'workspace')").bind(users.owner.id, WS),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_f73','art_f73_pol',?,'editor')").bind(users.editor.email),
    ...['art_f73_pol', 'art_f73_open'].map((a) => e.DB.prepare(
      "INSERT INTO notifications (id, recipient_type, recipient_id, kind, subject_type, subject_id, message) VALUES (?, 'artifact', ?, 'metric_watch', 'watch', 'mw', 'Row count jumped 50% (2 → 3)')").bind(`n_${a}`, a)),
  ]);
});

describe('f73 metric-watch notification fan-out', () => {
  it('blocks: restricted viewers get no whole-table metric notification; owner and editors do', async () => {
    expect(await feed(users.owner)).toEqual(expect.arrayContaining(['art_f73_pol', 'art_f73_open']));
    expect(await feed(users.editor)).toContain('art_f73_pol');
    expect(await feed(users.a)).not.toContain('art_f73_pol');
    expect(await feed(users.other)).not.toContain('art_f73_pol');
    expect(await feed(users.other)).toContain('art_f73_open');
  });
});
