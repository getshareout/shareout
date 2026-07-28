import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/** Agent flow: publish a new HTML artifact and confirm it is live. */
describe(`03 agent publish artifact @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-pub');
  }, 60_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifact?.artifactId);
  }, 30_000);

  it('publish returns artifact id and deployment URL', () => {
    expect(artifact.artifactId).toMatch(/^art_/);
    expect(artifact.slug).toContain('e2e-pub');
  });

  it('artifact appears in GET /v1/artifacts', async () => {
    const { response, body } = await client.listArtifacts();
    expect(response.status).toBe(200);
    expect(body?.artifacts?.some((a) => a.id === artifact.artifactId)).toBe(true);
  });

  it('sandbox viewer loads at /a/{slug}/', async () => {
    const response = await ShareOutClient.anonymous().getArtifactHtml(artifact.slug);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(artifact.slug);
  });

  it('raw bundle serves HTML content at ?_raw', async () => {
    const response = await ShareOutClient.anonymous().getArtifactRaw(artifact.slug);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(artifact.marker);
  });
});
