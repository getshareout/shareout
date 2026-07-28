import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';
import { cleanupTestArtifact, publishTestArtifact, type TestArtifact } from '../helpers/test-artifact';

/** Agent flow: use tables API for structured app data. */
describe(`08 agent tables crud @ ${baseUrl}`, () => {
  let client: ShareOutClient;
  let artifact: TestArtifact;
  let rowId: string;
  const table = 'e2e_tasks';

  beforeAll(async () => {
    client = ShareOutClient.withToken(await getFlowToken());
    artifact = await publishTestArtifact(client, 'e2e-tbl');
  }, 60_000);

  afterAll(async () => {
    await cleanupTestArtifact(client, artifact?.artifactId);
  }, 30_000);

  it('POST /tables/{name} inserts a row', async () => {
    const { response, body } = await client.tableInsert(artifact.artifactId, table, {
      title: 'Ship feature',
      status: 'open',
      priority: 1,
    });

    expect(response.status).toBe(201);
    expect(body?.success).toBe(true);
    expect(body?.data?.count).toBe(1);
    rowId = body?.data?.inserted?.[0]?.id as string;
    expect(rowId).toMatch(/^row_/);
  });

  it('POST /tables/{name}/query returns inserted row', async () => {
    const { response, body } = await client.tableQuery(artifact.artifactId, table, {
      filter: { status: 'open' },
    });

    expect(response.status).toBe(200);
    expect(body?.data?.rows?.some((r) => r.title === 'Ship feature')).toBe(true);
  });

  it('POST /tables/{name}/count returns row count', async () => {
    const { response, body } = await client.tableCount(artifact.artifactId, table);

    expect(response.status).toBe(200);
    expect(body?.data?.count).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /tables/{name}/{rowId} removes the row', async () => {
    const { response, body } = await client.tableDeleteRow(artifact.artifactId, table, rowId);

    expect(response.status).toBe(200);
    expect(body?.success).toBe(true);

    const count = await client.tableCount(artifact.artifactId, table);
    expect(count.body?.data?.count).toBe(0);
  });
});
