import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl, uniqueSlug } from '../helpers/env';
import { minimalArtifactHtml } from '../helpers/fixtures';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact } from '../helpers/test-artifact';

/** Agent flow: enforce visibility — public vs private artifacts. */
describe(`13 agent access control @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let publicId: string;
  let privateId: string;
  let publicSlug: string;
  let privateSlug: string;
  const publicMarker = `pub-${Date.now()}`;
  const privateMarker = `priv-${Date.now()}`;

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    publicSlug = uniqueSlug('e2e-pub');
    privateSlug = uniqueSlug('e2e-priv');

    const pub = await client.publish({
      name: 'Public E2E',
      slug: publicSlug,
      visibility: 'public',
      files: [{ path: 'index.html', content: minimalArtifactHtml('Public', publicMarker), mime: 'text/html' }],
    });
    const priv = await client.publish({
      name: 'Private E2E',
      slug: privateSlug,
      visibility: 'private',
      files: [{ path: 'index.html', content: minimalArtifactHtml('Private', privateMarker), mime: 'text/html' }],
    });

    publicId = pub.body!.artifact.id;
    privateId = priv.body!.artifact.id;
  }, 90_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, publicId);
    await cleanupTestArtifact(client, privateId);
  }, 30_000);

  it('anonymous user reads public artifact raw content', async () => {
    const response = await ShareOutClient.anonymous().getArtifactRaw(publicSlug);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(publicMarker);
  });

  it('anonymous user blocked from private artifact', async () => {
    const response = await ShareOutClient.anonymous().getArtifactHtml(privateSlug);
    expect(response.status).toBe(401);
  });

  it('owner lists both artifacts via API', async () => {
    const { response, body } = await client.listArtifacts();
    const ids = body?.artifacts?.map((a) => a.id) ?? [];
    expect(ids).toContain(publicId);
    expect(ids).toContain(privateId);
  });

  it('unauthenticated DELETE /artifacts/{id} fails', async () => {
    const { response } = await ShareOutClient.anonymous().deleteArtifact(publicId);
    expect(response.ok).toBe(false);
  });
});
