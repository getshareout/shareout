import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/** Agent flow: inspect artifact details after publishing. */
describe(`05 agent inspect artifact @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-inspect');
  }, 60_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifact?.artifactId);
  }, 30_000);

  it('GET /v1/artifacts/{id} returns artifact detail', async () => {
    const { response, body } = await client.getArtifact(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.id).toBe(artifact.artifactId);
    expect(body?.slug).toBe(artifact.slug);
    expect(body?.visibility).toBe('public');
  });

  it('GET /versions lists at least one version', async () => {
    const { response, body } = await client.getVersions(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.versions?.length).toBeGreaterThanOrEqual(1);
    expect(body?.versions?.[0]?.version_no).toBeGreaterThanOrEqual(1);
  });

  it('GET /files returns index.html content', async () => {
    const { response, body } = await client.getFiles(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.artifact_id).toBe(artifact.artifactId);
    const index = body?.files?.find((f) => f.path === 'index.html');
    expect(index?.content).toContain(artifact.marker);
  });
});
