import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/** Agent flow: share artifact access with collaborators. */
describe(`10 agent collaborators @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;
  const collaboratorEmail = `e2e-collab-${Date.now()}@example.com`;

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-collab');
  }, 60_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifact?.artifactId);
  }, 30_000);

  it('POST /collaborators adds a viewer', async () => {
    const { response, body } = await client.addCollaborators(
      artifact.artifactId,
      [collaboratorEmail],
      'viewer'
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
  });

  it('GET /collaborators lists the new collaborator', async () => {
    const { response, body } = await client.listCollaborators(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.collaborators?.some((c) => c.email === collaboratorEmail)).toBe(true);
  });

  it('DELETE /collaborators/{email} removes them', async () => {
    const { response } = await client.removeCollaborator(artifact.artifactId, collaboratorEmail);
    expect(response.status).toBe(200);

    const { body } = await client.listCollaborators(artifact.artifactId);
    expect(body?.collaborators?.some((c) => c.email === collaboratorEmail)).toBe(false);
  });
});
