import { describe, expect, it } from 'vitest';
import { getPlatform } from '../../../src/chat-platforms/registry';
import '../../../src/chat-platforms/slack/adapter';

describe('chat-platforms registry', () => {

  it('registers the slack adapter', () => {
    expect(getPlatform('slack')?.id).toBe('slack');
    expect(getPlatform('slack')?.featureFlag).toBe('ai.slack_bot');
  });

  it('returns null for unregistered platforms', () => {
    expect(getPlatform('telegram')).toBeNull();
  });
});

describe('chat-platforms feature flags', () => {
  it('includes the slack bot flag', async () => {
    const { FEATURE_KEYS } = await import('../../../src/features/registry');
    expect(FEATURE_KEYS.has('ai.slack_bot')).toBe(true);
  });
});
