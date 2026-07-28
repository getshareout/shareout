import { describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';

/** Agent flow: discover workspaces before publishing into one. */
describe(`11 agent workspaces @ ${baseUrl}`, () => {
  it('GET /v1/workspaces lists user workspaces', async () => {
    const client = ShareOutClient.withToken(await getFlowToken());
    const { response, body } = await client.listWorkspaces();

    expect(response.status).toBe(200);
    expect(Array.isArray(body?.workspaces)).toBe(true);
  });

  it('each workspace has id, name, and slug', async () => {
    const client = ShareOutClient.withToken(await getFlowToken());
    const { body } = await client.listWorkspaces();

    for (const ws of body?.workspaces ?? []) {
      expect(ws.id).toMatch(/^wsp_/);
      expect(ws.name).toBeTruthy();
      expect(ws.slug).toBeTruthy();
    }
  });
});
