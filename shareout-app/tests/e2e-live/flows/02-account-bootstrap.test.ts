import { describe, expect, it } from 'vitest';
import { ShareOutClient } from '../helpers/client';
import { baseUrl } from '../helpers/env';
import { getFlowToken } from '../helpers/session';

/** Agent flow: authenticate and verify account before publishing. */
describe(`02 agent account bootstrap @ ${baseUrl}`, () => {
  it('loads profile for the authenticated user', async () => {
    const client = ShareOutClient.withToken(await getFlowToken());
    const { response, body } = await client.getProfile();

    expect(response.status).toBe(200);
    expect(body?.id).toMatch(/^usr_/);
  });

  it('reads account tier', async () => {
    const client = ShareOutClient.withToken(await getFlowToken());
    const { response, body } = await client.getAccountTier();

    expect(response.status).toBe(200);
    expect(body?.tier).toBeTruthy();
  });

  it('updates profile metadata (agent session stamp)', async () => {
    const client = ShareOutClient.withToken(await getFlowToken());
    const stamp = new Date().toISOString();

    const patch = await client.updateProfile({
      metadata: { last_e2e_run: stamp, agent: 'e2e-live' },
    });

    expect(patch.response.status).toBe(200);

    const { body } = await client.getProfile();
    expect(body?.metadata).toMatchObject({ last_e2e_run: stamp, agent: 'e2e-live' });
  });

  it('lists existing artifacts the agent can manage', async () => {
    const client = ShareOutClient.withToken(await getFlowToken());
    const { response, body } = await client.listArtifacts();

    expect(response.status).toBe(200);
    expect(Array.isArray(body?.artifacts)).toBe(true);
    expect(typeof body?.has_more).toBe('boolean');
  });
});
