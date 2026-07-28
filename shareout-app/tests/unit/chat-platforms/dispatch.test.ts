import { describe, expect, it } from 'vitest';
import { buildSessionKey, chatDoInstanceId } from '../../../src/chat-platforms/dispatch';

describe('chat-platforms dispatch', () => {
  it('builds stable session keys', () => {
    expect(buildSessionKey('telegram', 42)).toBe('telegram:42');
    expect(buildSessionKey('slack', 'T1:U9')).toBe('slack:T1:U9');
  });

  it('keeps legacy Telegram DO ids for backward compatibility', () => {
    expect(chatDoInstanceId('telegram', 42)).toBe('42');
    expect(chatDoInstanceId('slack', 'T1:U9')).toBe('slack:T1:U9');
  });
});
