// A viewer's scheduled Slack delivery may only target their own linked Slack account.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { checkViewerSelfDelivery } from '../../../src/scheduling/jobs/permissions';
import type { JobConfig } from '../../../src/scheduling/jobs/types';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_vsd_a', 'a@example.com', 'a'), ('usr_vsd_b', 'b@example.com', 'b')"),
    e.DB.prepare(`INSERT INTO messaging_links (platform, session_key, user_id, platform_user_id, team_id, linked_at)
      VALUES ('slack', 'T1:UAAA', 'usr_vsd_a', 'UAAA', 'T1', '2026-01-01T00:00:00Z'), ('slack', 'T1:UBBB', 'usr_vsd_b', 'UBBB', 'T1', '2026-01-01T00:00:00Z')`),
  ]);
});

const dm = (slackUserId: string) => ({ targetType: 'dm', slackUserId }) as unknown as JobConfig;

describe('checkViewerSelfDelivery (slack)', () => {
  it('allows a DM to the caller\'s own linked Slack id', async () => {
    expect(await checkViewerSelfDelivery(e, 'usr_vsd_a', 'slack', dm('UAAA'))).toBeNull();
  });

  it('refuses a DM to another person\'s Slack id', async () => {
    expect(await checkViewerSelfDelivery(e, 'usr_vsd_a', 'slack', dm('UBBB'))).toMatch(/own linked Slack/);
    expect(await checkViewerSelfDelivery(e, 'usr_vsd_a', 'slack', dm('UZZZ'))).toMatch(/own linked Slack/);
  });
});
