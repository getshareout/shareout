// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { quickSearch } from '../../../src/search/quick-search';

const WS = 'wsp_f56';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f56_a', 'f56a@example.test', 'a'), ('usr_f56_b', 'f56b@example.test', 'b')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f56-w', 'usr_f56_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f56_a', ?, 'usr_f56_a', 'owner', 'internal'), ('wm_f56_b', ?, 'usr_f56_b', 'member', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES ('art_f56_priv', 'Private Payroll Sync', 'f56-priv', 'usr_f56_a', ?, 'private'), ('art_f56_ws', 'Shared Report', 'f56-ws', 'usr_f56_a', ?, 'workspace'), ('art_f56_bmine', 'Bobs Private', 'f56-bm', 'usr_f56_b', ?, 'private')").bind(WS, WS, WS),
    e.DB.prepare(`INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at) VALUES
      ('job_f56_priv', 'art_f56_priv', 'usr_f56_a', 'email', '0 * * * *', '{}', '0'),
      ('job_f56_ws', 'art_f56_ws', 'usr_f56_a', 'email', '0 * * * *', '{}', '0'),
      ('job_f56_bmine', 'art_f56_bmine', 'usr_f56_b', 'email', '0 * * * *', '{}', '0')`),
  ]);
});

describe('f56 search schedules group', () => {
  it('blocks: another member does not see schedules of a private artifact', async () => {
    const res = await quickSearch(e, 'usr_f56_b', { workspaceId: WS, groups: ['schedules'], q: '' });
    const ids = res.schedules.map((h) => h.id);
    expect(ids).not.toContain('job_f56_priv');
    expect(JSON.stringify(res)).not.toContain('Private Payroll Sync');
  });

  it('members still see workspace-visible schedules and their own private ones; owner sees theirs', async () => {
    const b = await quickSearch(e, 'usr_f56_b', { workspaceId: WS, groups: ['schedules'], q: '' });
    expect(b.schedules.map((h) => h.id).sort()).toEqual(['job_f56_bmine', 'job_f56_ws']);
    const a = await quickSearch(e, 'usr_f56_a', { workspaceId: WS, groups: ['schedules'], q: '' });
    expect(a.schedules.map((h) => h.id)).toContain('job_f56_priv');
  });
});
