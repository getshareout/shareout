import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl, uniqueSlug } from '../helpers/env';
import { minimalArtifactHtml } from '../helpers/fixtures';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact } from '../helpers/test-artifact';

/** Agent flow: safe republish with idempotency key (retries must not double-publish). */
describe(`14 agent idempotent publish @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifactId: string;
  const slug = uniqueSlug('e2e-idem');
  const idempotencyKey = `e2e-idem-${Date.now()}`;
  const marker = `idem-${Date.now()}`;

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());

    const first = await client.publish({
      name: `Idempotent ${slug}`,
      slug,
      files: [{ path: 'index.html', content: minimalArtifactHtml('Idem', marker), mime: 'text/html' }],
    }, { idempotencyKey });

    expect(first.response.status).toBe(201);
    artifactId = first.body!.artifact.id;

    const second = await client.publish({
      name: `Idempotent ${slug}`,
      slug: uniqueSlug('should-not-use'),
      files: [{ path: 'index.html', content: '<html>nope</html>', mime: 'text/html' }],
    }, { idempotencyKey });

    expect(second.response.headers.get('X-Idempotent-Replayed')).toBe('true');
    expect(second.body?.artifact.id).toBe(artifactId);
  }, 60_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifactId);
  }, 30_000);

  it('only one artifact was created for the slug', async () => {
    const raw = await ShareOutClient.anonymous().getArtifactRaw(slug);
    expect(raw.status).toBe(200);
    expect(await raw.text()).toContain(marker);
  });
});
