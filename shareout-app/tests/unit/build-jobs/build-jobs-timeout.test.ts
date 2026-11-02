// A build job that outlives JOB_TIMEOUT_MS is failed with the timeout copy, its clients get the
// closing event, and the abandoned build stops at its next step. The timeout is shortened here.
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { BuildEvent, BuildJobSpec, BuildJobView, Emit } from '../../../src/build-jobs/types';

// The same timeout also sweeps a job left queued (do.ts sweep): at 60ms a loaded machine let the
// alarm start late, so the job was swept as interrupted before its first step. 1s is still quick.
vi.mock('../../../src/build-jobs/types', async (orig) => ({ ...(await orig<object>()), JOB_TIMEOUT_MS: 1_000, LANDING_MS: 10 }));
vi.mock('../../../src/support/alert', () => ({ alertOps: vi.fn(async () => true) }));

import { applyMigrations } from '../helpers/migrated-db';
import * as runners from '../../../src/build-jobs/runners';
import { useBuildRunners } from '../../../src/build-jobs/do';

const testEnv = env as unknown as Env;
const gate = { open: false };
const after: string[] = [];

useBuildRunners({
  ...runners,
  // Reports one step, then hangs (a model call that never returns) until the test lets it go.
  runBuildJob: async (_env: Env, _spec: BuildJobSpec, emit: Emit) => {
    emit({ type: 'step', label: 'Planning your page…' });
    while (!gate.open) await new Promise((r) => setTimeout(r, 5));
    try {
      emit({ type: 'step', label: 'Publishing it…' });
    } catch (err) {
      after.push((err as Error).message);
      throw err;
    }
    return { ok: true, name: 'Late page' };
  },
});

beforeAll(async () => {
  await applyMigrations();
  await testEnv.DB.prepare("INSERT OR IGNORE INTO users (id, email, name) VALUES ('usr_bj_slow', 'slow@studio.test', 'Slow')").run();
});

// Each test waits on a Durable Object alarm round trip (~0.5s idle); a full run on a busy
// machine stretched that past the default 5s.
describe('BuildJobs timeout', { timeout: 30_000 }, () => {
  it('fails a build that runs too long, tells its client, and stops the build at its next step', async () => {
    const user = 'usr_bj_slow';
    const stub = testEnv.BUILD_JOBS!.get(testEnv.BUILD_JOBS!.idFromName(user));
    const spec = { kind: 'create', prompt: 'a page', previousHtml: '', locale: 'en', briefWorkspaceId: null, meter: { workspaceId: null, userId: user, kind: 'page_build' } };
    const res = await stub.fetch('https://build-jobs/start', { method: 'POST', body: JSON.stringify({ userId: user, spec, key: 'slow', name: 'Late page' }) });
    const reading = res.text();
    await runDurableObjectAlarm(stub);
    const evs = (await reading).split('\n\n').filter(Boolean).map((r) => JSON.parse(r.replace(/^data: /, '')) as BuildEvent);

    expect(evs.map((e) => e.type)).toEqual(['job', 'step', 'error']);
    expect(evs.at(-1)).toMatchObject({ error: 'The build took too long, so I stopped it. Try a simpler version, or build it in parts.' });
    const id = evs[0].id as string;
    const v = await (await stub.fetch(`https://build-jobs/job?id=${id}`)).json<BuildJobView>();
    expect(v).toMatchObject({ status: 'failed', outcome: { ok: false, reason: 'timeout' }, steps: ['Planning your page…'] });

    gate.open = true;
    for (let i = 0; i < 2000 && !after.length; i++) await new Promise((r) => setTimeout(r, 5));
    expect(after).toEqual(['build job already ended']);
    expect((await (await stub.fetch(`https://build-jobs/job?id=${id}`)).json<BuildJobView>()).status).toBe('failed');
  });
});
