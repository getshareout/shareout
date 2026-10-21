// @vitest-environment node
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
import { emitCrewEvent } from '../../../src/crew/triggers';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f23', 'f23@example.test', 'o')"),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES ('art_f23', 'usr_f23', 'P', 'f23', 'private')"),
    e.DB.prepare("INSERT INTO crews (id, artifact_id, owner_id, status) VALUES ('crew_f23', 'art_f23', 'usr_f23', 'active')"),
    e.DB.prepare("INSERT INTO crew_triggers (id, crew_id, artifact_id, kind, event_type, enabled) VALUES ('ctr_f23', 'crew_f23', 'art_f23', 'event', 'table.row.inserted', 1)"),
  ]);
});

describe('f23 event trigger cooldown', () => {
  it('blocks: a burst of writes starts one crew run per cooldown window', async () => {
    for (let i = 0; i < 5; i++) await emitCrewEvent(e, 'art_f23', 'table.row.inserted');
    expect(h.createRun).toHaveBeenCalledTimes(1);
  });

  it('fires again once the cooldown has passed', async () => {
    await e.DB.prepare("UPDATE crew_triggers SET last_run_at = '2000-01-01T00:00:00.000Z'").run();
    await emitCrewEvent(e, 'art_f23', 'table.row.inserted');
    expect(h.createRun).toHaveBeenCalledTimes(2);
  });
});
