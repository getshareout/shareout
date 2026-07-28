import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl, uniqueSlug } from '../helpers/env';
import { minimalArtifactHtml } from '../helpers/fixtures';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact } from '../helpers/test-artifact';

/** Repro: user edits in the visual editor, hits Publish, but the live URL keeps serving the old version. */
describe(`99 editor publish roundtrip @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifactId: string;
  let slug: string;
  const markerV1 = `editor-v1-${Date.now()}`;
  const markerV2 = `editor-v2-${Date.now()}`;

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    slug = uniqueSlug('e2e-editor');

    const first = await client.publish({
      name: `Editor test ${slug}`,
      slug,
      files: [{ path: 'index.html', content: minimalArtifactHtml('V1', markerV1), mime: 'text/html' }],
    });
    if (!first.response.ok) throw new Error('Initial publish failed: ' + first.text);
    artifactId = first.body!.artifact.id;
  }, 90_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifactId);
  }, 30_000);

  it('serves V1 before the editor publish', async () => {
    const html = await (await client.getArtifactRaw(slug)).text();
    expect(html).toContain(markerV1);
  });

  it('editor publish endpoint accepts the new HTML', async () => {
    const { response, body } = await client.request<{ success: boolean; versionNo: number }>(
      `/v1/artifacts/${artifactId}/editor/publish`,
      {
        method: 'POST',
        body: JSON.stringify({ html: minimalArtifactHtml('V2', markerV2) }),
      }
    );
    expect(response.status).toBe(200);
    expect(body?.success).toBe(true);
  }, 30_000);

  it('live URL serves V2 within the cache TTL window', async () => {
    let html = '';
    let attempts = 0;
    // Poll up to ~75s (KV deploy cache TTL is 60s) checking how long the old version lingers.
    for (let i = 0; i < 25; i++) {
      attempts = i + 1;
      html = await (await client.getArtifactRaw(slug)).text();
      if (html.includes(markerV2)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    console.log(`[editor-roundtrip] V2 visible after ~${(attempts - 1) * 3}s (${attempts} polls)`);
    expect(html).toContain(markerV2);
    expect(html).not.toContain(markerV1);
  }, 90_000);
});
