import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/** Agent flow: persist and retrieve JSON settings via the data API. */
describe(`07 agent json store @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;
  const key = 'agent_settings';

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-json');
  }, 60_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifact?.artifactId);
  }, 30_000);

  it('PUT /v1/data/{id}/json/{key} stores settings', async () => {
    const payload = { theme: 'dark', onboarding: true, ts: Date.now() };
    const { response, body } = await client.dataJsonPut(artifact.artifactId, key, payload);

    expect([200, 201]).toContain(response.status);
    expect(body?.success).toBe(true);
  });

  it('GET /json lists the stored key', async () => {
    const { response, body } = await client.dataJsonList(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.data?.keys).toContain(key);
  });

  it('GET /json/{key} returns the stored value', async () => {
    const { response, body } = await client.dataJsonGet(artifact.artifactId, key);

    expect(response.status).toBe(200);
    expect(body?.data?.value).toMatchObject({ theme: 'dark', onboarding: true });
  });

  it('DELETE /json/{key} removes the key', async () => {
    const { response, body } = await client.dataJsonDelete(artifact.artifactId, key);

    expect(response.status).toBe(200);
    expect(body?.success).toBe(true);

    const missing = await client.dataJsonGet(artifact.artifactId, key);
    expect(missing.response.status).toBe(404);
  });
});
