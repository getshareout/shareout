import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/** Agent flow: patch artifact metadata without republishing files. */
describe(`06 agent update metadata @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;
  const updatedName = `E2E Updated ${Date.now()}`;
  const description = 'Updated by agent E2E flow';

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-meta');
  }, 60_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifact?.artifactId);
  }, 30_000);

  it('PATCH /v1/artifacts/{id} updates name and description', async () => {
    const { response } = await client.updateArtifact(artifact.artifactId, {
      name: updatedName,
      description,
    });

    expect(response.status).toBe(200);
  });

  it('GET confirms metadata changes persisted', async () => {
    const { response, body } = await client.getArtifact(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.name).toBe(updatedName);
  });
});
