import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/** Agent flow: upload a file via blob token upload. */
describe(`09 agent blobs upload @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;
  let blobId: string;
  const filename = 'e2e-notes.txt';
  const content = `E2E blob upload ${Date.now()}\nAgent test file.`;

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-blob');
  }, 60_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifact?.artifactId);
  }, 30_000);

  it('POST /blobs/upload returns upload URL', async () => {
    const { response, body } = await client.blobRequestUpload(
      artifact.artifactId,
      filename,
      'text/plain',
      content.length
    );

    expect(response.status).toBe(201);
    const data = body!.data!;

    if (data.direct) {
      // Direct-to-R2 path (no Origin → presigned PUT): upload bytes, then confirm.
      const put = await client.blobUpload(data.uploadUrl, content, 'text/plain');
      expect(put.response.ok).toBe(true);
      const confirm = await client.blobConfirm(artifact.artifactId, data.tokenId);
      expect(confirm.response.status).toBe(201);
      blobId = confirm.body?.data?.id as string;
    } else {
      // Worker-proxied path: single PUT writes bytes + metadata.
      expect(data.uploadUrl).toContain('/blobs/_upload/');
      const upload = await client.blobUpload(data.uploadUrl, content, 'text/plain');
      expect(upload.response.status).toBe(201);
      blobId = upload.body?.data?.id as string;
    }
    expect(blobId).toMatch(/^blob_/);
  });

  it('GET /blobs lists uploaded file', async () => {
    const { response, body } = await client.blobList(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.data?.blobs?.some((b) => b.filename === filename)).toBe(true);
  });

  it('GET /blobs/{id} returns metadata', async () => {
    const { response, body } = await client.blobGet(artifact.artifactId, blobId);

    expect(response.status).toBe(200);
    expect(body?.data?.filename).toBe(filename);
    expect(body?.data?.mimeType).toBe('text/plain');
  });

  it('GET /blobs/storage reports usage', async () => {
    const { response, body } = await client.blobStorage(artifact.artifactId);

    expect(response.status).toBe(200);
    expect(body?.data?.blobCount).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /blobs/{id} removes the blob', async () => {
    const { response, body } = await client.blobDelete(artifact.artifactId, blobId);

    expect(response.status).toBe(200);
    expect(body?.success).toBe(true);
  });
});
