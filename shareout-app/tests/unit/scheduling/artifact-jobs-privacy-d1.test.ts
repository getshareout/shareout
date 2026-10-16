// Per-artifact schedule listing (GET /v1/jobs?artifact_id=, the Automate tab) on real D1:
// owners/editors see shared schedules + their own DM subscriptions, never someone else's.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import initSql from '../../../migrations/0000_init.sql?raw';
import { listJobsForArtifact } from '../../../src/scheduling/jobs/crud';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;
const ART = 'art_dmpriv';
const OWNER = 'usr_dmp_owner', EDITOR = 'usr_dmp_editor', VIEWER = 'usr_dmp_viewer';

async function job(id: string, owner: string, action: string, config: unknown) {
  await e.DB.prepare(
    `INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at)
     VALUES (?, ?, ?, ?, '0 9 * * 1', ?, '2026-10-20T09:00:00.000Z')`,
  ).bind(id, ART, owner, action, JSON.stringify(config)).run();
}

beforeAll(async () => {
  const stmts = initSql.replace(/--[^\n]*/g, '').split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < stmts.length; i += 50) await e.DB.batch(stmts.slice(i, i + 50).map((x) => e.DB.prepare(x)));

  for (const [id, email] of [[OWNER, 'owner@example.com'], [EDITOR, 'editor@example.com'], [VIEWER, 'viewer@example.com']]) {
    await e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, email).run();
  }
  await e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id) VALUES (?, 'Acme report', 'acme-dmpriv', ?)").bind(ART, OWNER).run();
  await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_dmp_e', ?, 'editor@example.com', 'editor'), ('col_dmp_v', ?, 'viewer@example.com', 'viewer')").bind(ART, ART).run();

  await job('job_shared_slack', OWNER, 'slack', { targetType: 'channel', channelId: 'C1' });
  await job('job_shared_email', EDITOR, 'email', { recipients: ['team@example.com', 'boss@example.com'] });
  await job('job_owner_dm', OWNER, 'slack', { targetType: 'dm', slackUserId: 'U_OWNER' });
  await job('job_editor_email_self', EDITOR, 'email', { recipients: ['Editor@example.com'] });
  await job('job_viewer_dm', VIEWER, 'slack', { targetType: 'dm', slackUserId: 'U_VIEWER' });
  await job('job_viewer_email_self', VIEWER, 'email', { recipients: ['viewer@example.com'] });
  await job('job_viewer_tg', VIEWER, 'telegram', {});
});

const ids = async (user: string) => (await listJobsForArtifact(e, ART, user)).map((j) => j.id).sort();

describe('listJobsForArtifact — DM subscription privacy', () => {
  it('an owner sees shared schedules + own DM, not other users\' DM subscriptions', async () => {
    expect(await ids(OWNER)).toEqual(['job_owner_dm', 'job_shared_email', 'job_shared_slack']);
  });

  it('an editor sees shared schedules + own self-email, not the owner\'s or a viewer\'s DMs', async () => {
    expect(await ids(EDITOR)).toEqual(['job_editor_email_self', 'job_shared_email', 'job_shared_slack']);
  });

  it('a viewer sees only their own subscriptions', async () => {
    expect(await ids(VIEWER)).toEqual(['job_viewer_dm', 'job_viewer_email_self', 'job_viewer_tg']);
  });

  it('a stranger sees nothing', async () => {
    expect(await ids('usr_dmp_nobody')).toEqual([]);
  });
});
