import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl, uniqueSlug } from '../helpers/env';
import { minimalArtifactHtml } from '../helpers/fixtures';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact } from '../helpers/test-artifact';

/** Agent flow: update an existing artifact by republishing to the same slug. */
describe(`04 agent republish version @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifactId: string;
  let slug: string;
  const markerV1 = `v1-${Date.now()}`;
  const markerV2 = `v2-${Date.now()}`;

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    slug = uniqueSlug('e2e-ver');

    const first = await client.publish({
      name: `Version test ${slug}`,
      slug,
      files: [{ path: 'index.html', content: minimalArtifactHtml('V1', markerV1), mime: 'text/html' }],
    });
    if (!first.response.ok) throw new Error('Initial publish failed');
    artifactId = first.body!.artifact.id;

    const second = await client.publish({
      name: `Version test ${slug}`,
      slug,
      files: [{ path: 'index.html', content: minimalArtifactHtml('V2', markerV2), mime: 'text/html' }],
    });
    if (!second.response.ok) throw new Error('Republish failed');
    expect(second.body!.version.version_no).toBeGreaterThan(first.body!.version.version_no);
  }, 90_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifactId);
  }, 30_000);

  it('GET /versions shows multiple versions', async () => {
    const { response, body } = await client.getVersions(artifactId);

    expect(response.status).toBe(200);
    expect(body?.versions?.length).toBeGreaterThanOrEqual(2);
  });

  it('live deployment serves the latest content', async () => {
    const response = await ShareOutClient.anonymous().getArtifactRaw(slug);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(markerV2);
    expect(html).not.toContain(markerV1);
  });

  it('GET /files returns current version bundle', async () => {
    const { response, body } = await client.getFiles(artifactId);

    expect(response.status).toBe(200);
    expect(body?.files?.some((f) => f.path === 'index.html' && f.content.includes(markerV2))).toBe(true);
  });
});
