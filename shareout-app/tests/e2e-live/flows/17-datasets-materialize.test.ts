import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/** Agent flow: materialize rows into a dataset, then read metadata + content. */
describe(`17 agent datasets materialize @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;
  const connName = 'e2e_extract_src';
  const datasetName = 'e2e_shipments';
  const rows = [
    { id: 1, status: 'ok', region: 'east' },
    { id: 2, status: 'delayed', region: 'west' },
    { id: 3, status: 'ok', region: 'west' },
  ];

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-ds');

    const created = await client.createConnection(artifact.artifactId, {
      name: connName,
      type: 'rest_api',
      config: { baseUrl: 'https://httpbin.org' },
      cacheTtl: 60,
    });
    // CREDENTIALS_KEY missing → 500 CONFIG_ERROR on some instances; surface clearly.
    if (created.response.status === 500) {
      console.warn('createConnection returned 500 — CREDENTIALS_KEY may be unset on this instance');
    }
    expect([201, 200]).toContain(created.response.status);
    expect(created.body?.success).toBe(true);
  }, 60_000);

  afterAll(async () => {
    if (artifact?.artifactId) {
      await client.deleteDataset(artifact.artifactId, datasetName).catch(() => undefined);
      await client.deleteConnection(artifact.artifactId, connName).catch(() => undefined);
      await cleanupTestArtifact(client, artifact.artifactId);
    }
  }, 30_000);

  it('POST …/materialize writes a dataset from inline rows', async () => {
    const { response, body } = await client.materializeConnection(
      artifact.artifactId,
      connName,
      {
        rows,
        target: { type: 'dataset', name: datasetName },
        format: 'json',
        mode: 'replace',
      },
    );

    expect([200, 201]).toContain(response.status);
    expect(body?.success).toBe(true);
    expect(body?.data?.target).toBe('dataset');
    expect(body?.data?.name).toBe(datasetName);
    expect(body?.data?.rowCount).toBe(rows.length);
    expect((body?.data?.version ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('GET /datasets lists the materialized extract', async () => {
    const { response, body } = await client.listDatasets(artifact.artifactId);
    expect(response.status).toBe(200);
    expect(body?.data?.datasets?.some((d) => d.name === datasetName)).toBe(true);
  });

  it('GET /datasets/{name} returns metadata', async () => {
    const { response, body } = await client.getDataset(artifact.artifactId, datasetName);
    expect(response.status).toBe(200);
    expect(body?.data?.name).toBe(datasetName);
    expect(body?.data?.format).toBe('json');
    expect((body?.data?.sizeBytes ?? 0)).toBeGreaterThan(0);
  });

  it('GET /datasets/{name}/content returns paged rows', async () => {
    const { response, body } = await client.datasetContent(artifact.artifactId, datasetName, {
      offset: 0,
      limit: 10,
    });
    expect(response.status).toBe(200);
    expect(body?.data?.total).toBe(rows.length);
    expect(body?.data?.data).toEqual(rows);
    expect(body?.data?.hasMore).toBe(false);
  });

  it('materialize → json key for first-paint snapshots', async () => {
    const { response, body } = await client.materializeConnection(
      artifact.artifactId,
      connName,
      {
        rows: [{ k: 'v' }],
        target: { type: 'json', name: 'e2e_snapshot' },
      },
    );
    expect([200, 201]).toContain(response.status);
    expect(body?.success).toBe(true);
    expect(body?.data?.target).toBe('json');

    const got = await client.dataJsonGet(artifact.artifactId, 'e2e_snapshot');
    expect(got.response.status).toBe(200);
    expect(got.body?.data?.value).toEqual([{ k: 'v' }]);
  });
});
