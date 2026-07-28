// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tasksForTrack } from '../../../src/onboarding/tasks';
import type { Env } from '../../../src/types';

const env = (vars: Record<string, string> = {}) => vars as unknown as Env;

const keys = (track: 'admin' | 'member' | 'personal', e?: Env) =>
  tasksForTrack(track, e).map((t) => t.key);

const CONFIGURED = env({
  TELEGRAM_BOT_TOKEN: 'bot:123',
  SLACK_CLIENT_ID: 'slack-id',
  SLACK_CLIENT_SECRET: 'slack-secret',
});

describe('tasksForTrack capability filtering', () => {
  it('keeps the full ladder when no env is supplied', () => {
    expect(keys('admin')).toContain('telegram');
    expect(keys('admin')).toContain('slack');
  });

  it('keeps every task on a fully configured instance', () => {
    expect(keys('admin', CONFIGURED)).toEqual(keys('admin'));
    expect(keys('member', CONFIGURED)).toEqual(keys('member'));
  });

  // The failure this fixes: `telegram` is NOT skippable, and status.ts measures
  // completion over non-skippable tasks only. Its signal fires when a user links a
  // Telegram account, which needs a bot token — so on an instance without one the
  // checklist could never reach 100% and the finish moment never fired.
  it('drops the Telegram task when the instance has no bot token', () => {
    expect(keys('admin', env())).not.toContain('telegram');
    expect(keys('member', env())).not.toContain('telegram');
  });

  it('drops the Slack task when Slack credentials are absent', () => {
    expect(keys('admin', env())).not.toContain('slack');
  });

  it('drops Slack when only half the credential pair is set', () => {
    expect(keys('admin', env({ SLACK_CLIENT_ID: 'only-id' }))).not.toContain('slack');
  });

  it('leaves tasks that depend on nothing external', () => {
    const bare = keys('admin', env());
    expect(bare).toContain('first_artifact');
    expect(bare).toContain('skill');
    expect(bare.length).toBeGreaterThan(0);
  });

  // The personal track never had integration tasks; filtering must not disturb it.
  it('leaves the personal track untouched', () => {
    expect(keys('personal', env())).toEqual(keys('personal'));
  });

  it('leaves a completable ladder on a bare instance', () => {
    for (const track of ['admin', 'member', 'personal'] as const) {
      const remaining = tasksForTrack(track, env());
      const required = remaining.filter((t) => !t.skippable);
      // Something must remain required, or `pct` would read 100% before any work.
      expect(required.length, track).toBeGreaterThan(0);
    }
  });
});
