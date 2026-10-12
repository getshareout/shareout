// @vitest-environment node
// The admin portal's default views must run against the real migrated schema.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { renderAdminFragment } from '../../../src/superadmin/page';
import { getDailyPlatformDigest } from '../../../src/superadmin/digest';
import { investigatePlatformMetrics } from '../../../src/superadmin/digest-investigate';
import { getAnalystContext } from '../../../src/superadmin/pulse';

beforeAll(async () => {
  await applyMigrations();
});

describe('admin views on the migrated schema', () => {
  for (const view of ['overview', 'workspaces']) {
    it(`renders ${view}`, async () => {
      const out = await renderAdminFragment(e, view, '30');
      expect(out).toBeTruthy();
    });
  }

  it('builds the daily digest', async () => {
    const out = await getDailyPlatformDigest(e, '2026-10-11');
    expect(out).toBeTruthy();
  });

  for (const topic of ['marketing_funnel', 'errors'] as const) {
    it(`investigates ${topic}`, async () => {
      expect(await investigatePlatformMetrics(e, { topic, date: '2026-10-11' })).toBeTruthy();
    });
  }

  it('builds the analyst context', async () => {
    expect(await getAnalystContext(e)).toBeTruthy();
  });
});
