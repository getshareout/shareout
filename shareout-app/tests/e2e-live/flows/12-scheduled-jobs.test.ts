import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/**
 * Agent flow: schedule a webhook job, run it now, and read the outcome back from
 * run history — once against a reachable URL, once against one that can't resolve.
 * Local: SHAREOUT_E2E_BASE_URL=http://localhost:55162 SHAREOUT_E2E_TOKEN=… \
 *   npx vitest run -c vitest.e2e-live.config.ts e2e-live/flows/12-scheduled-jobs.test.ts
 */
describe(`12 agent scheduled jobs @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;
  let jobId = '';
  let brokenJobId = '';

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-job');
  }, 60_000);

  afterAll(async () => {
    if (jobId) await client.deleteJob(jobId);
    if (brokenJobId) await client.deleteJob(brokenJobId);
    await cleanupTestArtifact(client, artifact?.artifactId);
  }, 30_000);

  it('POST /v1/jobs creates a webhook job', async () => {
    const { response, body } = await client.createJob({
      artifact_id: artifact.artifactId,
      action: 'webhook',
      schedule: '0 0 1 1 *', // Jan 1 — far future; we trigger it manually
      config: { url: 'https://example.com/', method: 'GET' },
    });

    expect(response.status, body?.error).toBe(201);
    jobId = body!.job!.id;
    expect(jobId).toMatch(/^job_/);
  });

  it('GET /v1/jobs lists the job for the artifact', async () => {
    const { response, body } = await client.listJobs(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.jobs?.some((j) => j.id === jobId)).toBe(true);
  });

  it('POST /v1/jobs/{id}/run delivers and lands in run history', async () => {
    const run = await client.runJob(jobId);
    expect(run.response.status).toBe(200);
    expect(run.body?.execution, run.body?.execution?.error).toMatchObject({ success: true, status: 'success' });

    const logs = await client.getJobLogs(jobId);
    expect(logs.response.status).toBe(200);
    expect(logs.body?.logs?.[0]).toMatchObject({ status: 'success', error: null });
  }, 30_000);

  it('a failing run reports why, in the response and in run history', async () => {
    const created = await client.createJob({
      artifact_id: artifact.artifactId,
      action: 'webhook',
      schedule: '0 0 1 1 *',
      config: { url: 'https://unreachable.invalid/hook' },
    });
    expect(created.response.status, created.body?.error).toBe(201);
    brokenJobId = created.body!.job!.id;

    const run = await client.runJob(brokenJobId);
    expect(run.response.status).toBe(200);
    expect(run.body?.execution?.success).toBe(false);
    expect(run.body?.execution?.error).toMatch(/^Webhook failed/);

    const logs = await client.getJobLogs(brokenJobId);
    expect(logs.body?.logs?.[0]).toMatchObject({ status: 'failed', error: run.body?.execution?.error });
  }, 30_000);

  it('DELETE /v1/jobs/{id} removes the job', async () => {
    const { response, body } = await client.deleteJob(jobId);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    jobId = '';
  });
});
