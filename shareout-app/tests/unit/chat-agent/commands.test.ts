import { describe, expect, it } from 'vitest';
import { commandToAgentPrompt, botFeatureFlag } from '../../../src/chat-agent/commands';

describe('chat-agent commands', () => {
  it('maps snapshot command to an agent prompt', () => {
    expect(commandToAgentPrompt('snapshot', 'acme report')).toMatch(/snapshot/i);
    expect(commandToAgentPrompt('snapshot', '')).toBeTruthy();
  });

  it('returns null for unknown commands', () => {
    expect(commandToAgentPrompt('unknown', '')).toBeNull();
  });

  it('resolves feature flags per platform', () => {
    expect(botFeatureFlag('telegram')).toBe('ai.telegram_bot');
    expect(botFeatureFlag('slack')).toBe('ai.slack_bot');
  });
});
