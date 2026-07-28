import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/** Agent flow: schedule a webhook job on an artifact. */
describe(`12 agent scheduled jobs @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;
  let jobId: string;

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-job');
  }, 60_000);

  afterAll(async () => {
    if (jobId) await client.deleteJob(jobId);
    await cleanupTestArtifact(client, artifact?.artifactId);
  }, 30_000);

  it('POST /v1/jobs creates a webhook job', async () => {
    const { response, body } = await client.createJob({
      artifact_id: artifact.artifactId,
      action: 'webhook',
      schedule: '0 0 1 1 *',
      config: {
        url: 'https://example.com/webhook',
        method: 'POST',
        includeArtifactData: false,
      },
    });

    expect(response.status).toBe(201);
    jobId = body!.job!.id;
    expect(jobId).toMatch(/^job_/);
  });

  it('GET /v1/jobs lists the job for the artifact', async () => {
    const { response, body } = await client.listJobs(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.jobs?.some((j) => j.id === jobId)).toBe(true);
  });

  it('DELETE /v1/jobs/{id} removes the job', async () => {
    const { response, body } = await client.deleteJob(jobId);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    jobId = '';
  });
});
