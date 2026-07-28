import { describe, expect, it } from 'vitest';
import { slackSessionKey, parseSlackSessionKey } from '../../../../src/chat-platforms/slack/linking';

describe('slack session keys', () => {
  it('builds and parses team:user keys', () => {
    expect(slackSessionKey('T1', 'U9')).toBe('T1:U9');
    expect(parseSlackSessionKey('T1:U9')).toEqual({ teamId: 'T1', userId: 'U9' });
  });

  it('returns null for invalid keys', () => {
    expect(parseSlackSessionKey('')).toBeNull();
    expect(parseSlackSessionKey('nocolon')).toBeNull();
  });
});
