import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';
import { getDestination } from '../../src/delivery/registry';
import type { DeliveryContext } from '../../src/delivery/types';

const env = {} as Env;
const ctx: DeliveryContext = { artifactId: 'art_1', createdBy: 'user_1', triggeredVia: 'manual' };

describe('delivery registry', () => {
  it('resolves every known destination kind and rejects unknown', () => {
    for (const kind of ['slack', 'email', 'discord', 'webhook', 'http_get', 'materialize', 'telegram', 'query_snapshot', 'artifact_test']) {
      expect(getDestination(kind)?.kind).toBe(kind);
    }
    expect(getDestination('sms')).toBeNull();
  });
});

describe('artifact_test destination', () => {
  const dest = getDestination('artifact_test')!;

  it('needs no config to validate', async () => {
    expect(await dest.validate(env, ctx, {})).toBeNull();
  });

  it('is a no-op success when the artifact has no tests enabled', async () => {
    const noTestsEnv = {
      DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
    } as unknown as Env;
    expect(await dest.deliver(noTestsEnv, ctx, {})).toEqual({ success: true });
  });
});

describe('slack destination validate', () => {
  const slack = getDestination('slack')!;

  it('requires channelId for a channel post', async () => {
    expect(await slack.validate(env, ctx, { connection: 'team' })).toMatch(/channelId is required/);
    expect(await slack.validate(env, ctx, { connection: 'team', channelId: 'C1' })).toBeNull();
  });

  it('requires slackUserId for a DM', async () => {
    expect(await slack.validate(env, ctx, { connection: 'team', targetType: 'dm' })).toMatch(/slackUserId is required/);
    expect(await slack.validate(env, ctx, { connection: 'team', targetType: 'dm', slackUserId: 'U1' })).toBeNull();
  });

  it('requires https for legacy webhook delivery', async () => {
    expect(await slack.validate(env, ctx, {})).toMatch(/webhookUrl or connection/);
    expect(await slack.validate(env, ctx, { webhookUrl: 'http://x' })).toMatch(/HTTPS/);
    expect(await slack.validate(env, ctx, { webhookUrl: 'https://hooks.slack.com/x' })).toBeNull();
  });
});

describe('webhook destination validate', () => {
  const webhook = getDestination('webhook')!;

  it('requires an https url', async () => {
    expect(await webhook.validate(env, ctx, { url: '' })).toMatch(/required/);
    expect(await webhook.validate(env, ctx, { url: 'http://x' })).toMatch(/HTTPS/);
    expect(await webhook.validate(env, ctx, { url: 'https://x.com' })).toBeNull();
  });
});
