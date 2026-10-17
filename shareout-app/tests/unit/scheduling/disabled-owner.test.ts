// Scheduled jobs and autonomous crew runs stop once their owner's account is disabled.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ runCrewToCompletion: vi.fn(async () => {}), createRun: vi.fn(async () => ({ id: 'run_x' })) }));
vi.mock('../../../src/crew/run-loop', async (orig) => ({ ...(await orig<object>()), runCrewToCompletion: h.runCrewToCompletion }));
vi.mock('../../../src/crew/store', async (orig) => ({ ...(await orig<object>()), createRun: h.createRun }));
vi.mock('../../../src/crew/principal', async (orig) => ({ ...(await orig<object>()), buildOwnerDataContextForCrew: async () => ({}) }));
vi.mock('../../../src/crew/limits', async (orig) => ({
  ...(await orig<object>()),
  resolveCrewLimits: async () => ({ max_concurrent_runs: 5 }),
  countActiveRuns: async () => 0,
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { executeJobAction } from '../../../src/scheduling/jobs/runner';
import { dispatchCrewRun } from '../../../src/crew/triggers';
import type { CrewRow } from '../../../src/crew/types';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name, disabled) VALUES ('usr_do_on', 'on@example.com', 'on', 0), ('usr_do_off', 'off@example.com', 'off', 1)"),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES ('art_do_off', 'usr_do_off', 'P', 'do-off', 'private'), ('art_do_on', 'usr_do_on', 'Q', 'do-on', 'private')"),
  ]);
});

const crew = (owner: string, artifact: string) => ({ id: `crw_${owner}`, artifact_id: artifact, workspace_id: null, owner_id: owner, status: 'active' }) as unknown as CrewRow;

describe('disabled owners', () => {
  it('disables a scheduled job whose creator is disabled', async () => {
    const res = await executeJobAction(e, 'email', 'art_do_off', 'usr_do_off', {} as never);
    expect(res).toMatchObject({ success: false, disable: true });
  });

  it('does not dispatch a crew run for a disabled owner', async () => {
    expect(await dispatchCrewRun(e, crew('usr_do_off', 'art_do_off'), 'cron')).toBe(false);
    expect(h.createRun).not.toHaveBeenCalled();
    expect(await dispatchCrewRun(e, crew('usr_do_on', 'art_do_on'), 'cron')).toBe(true);
    expect(h.createRun).toHaveBeenCalledTimes(1);
  });
});
