import { describe, expect, it, vi } from 'vitest';
import { getOnboardingStatus, getPersonalOnboardingStatus } from '../../src/onboarding/status';
import type { Env } from '../../src/types';

type Row = Record<string, unknown> | null;

/** Mock D1 that returns a row per query, matched by a distinctive SQL fragment. */
function makeDb(rows: {
  member?: Row;
  state?: Row;
  signals?: Row;
  user?: Row;
}): Env['DB'] {
  function resolve(sql: string): Row {
    if (sql.includes('FROM workspace_members')) return rows.member ?? null;
    if (sql.includes('FROM onboarding_state')) return rows.state ?? null;
    if (sql.includes('AS firstArtifact')) return rows.signals ?? {};
    if (sql.includes('FROM users')) return rows.user ?? null;
    return null;
  }
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({ first: vi.fn(async () => resolve(sql)) })),
    })),
  } as unknown as Env['DB'];
}

// These tests assert the FULL task ladder, which now requires the instance to have
// the integrations those tasks depend on (see onboarding/tasks.ts). A bare instance
// is covered separately in onboarding/capability-tasks.test.ts.
const INTEGRATIONS = {
  TELEGRAM_BOT_TOKEN: 'bot:test',
  SLACK_CLIENT_ID: 'slack-id',
  SLACK_CLIENT_SECRET: 'slack-secret',
};

const WS = 'wsp_1';
const U = 'usr_1';
const nowIso = new Date().toISOString();
const oldIso = new Date(Date.now() - 60 * 86_400_000).toISOString();

const NO_SIGNALS = { firstArtifact: 0, dataSource: 0, slack: 0, alert: 0, telegram: 0, viewed: 0, commented: 0 };

describe('getOnboardingStatus', () => {
  it('returns null for a non-member', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({ member: null }) } as Env;
    expect(await getOnboardingStatus(env, WS, U)).toBeNull();
  });

  it('returns null for an external member', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({ member: { role: 'member', created_at: nowIso, member_class: 'external' } }) } as Env;
    expect(await getOnboardingStatus(env, WS, U)).toBeNull();
  });

  it('gives a fresh admin the 6-task admin track at 0% and eligible', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({
      member: { role: 'owner', created_at: nowIso, member_class: 'internal' },
      signals: NO_SIGNALS,
    }) } as Env;
    const s = await getOnboardingStatus(env, WS, U);
    expect(s?.track).toBe('admin');
    expect(s?.tasks).toHaveLength(6);
    expect(s?.pct).toBe(0);
    expect(s?.eligible).toBe(true);
    expect(s?.celebrated).toBe(false);
  });

  it('excludes skippable Slack from pct (3 of 5 required = 60%)', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({
      member: { role: 'admin', created_at: nowIso, member_class: 'internal' },
      signals: { ...NO_SIGNALS, firstArtifact: 1, dataSource: 1, telegram: 1, slack: 1 },
    }) } as Env;
    const s = await getOnboardingStatus(env, WS, U);
    expect(s?.pct).toBe(60);
    expect(s?.tasks.find((t) => t.key === 'slack')?.done).toBe(true);
  });

  it('routes a plain member to the 4-task member track', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({
      member: { role: 'member', created_at: nowIso, member_class: 'internal' },
      signals: NO_SIGNALS,
    }) } as Env;
    const s = await getOnboardingStatus(env, WS, U);
    expect(s?.track).toBe('member');
    expect(s?.tasks).toHaveLength(4);
  });

  it('is not eligible once dismissed', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({
      member: { role: 'owner', created_at: nowIso, member_class: 'internal' },
      state: { skill_ack_at: null, dismissed_at: nowIso, celebrated_at: null },
      signals: NO_SIGNALS,
    }) } as Env;
    const s = await getOnboardingStatus(env, WS, U);
    expect(s?.dismissed).toBe(true);
    expect(s?.eligible).toBe(false);
  });

  it('is not eligible for a member who joined outside the 14-day window', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({
      member: { role: 'owner', created_at: oldIso, member_class: 'internal' },
      signals: NO_SIGNALS,
    }) } as Env;
    const s = await getOnboardingStatus(env, WS, U);
    expect(s?.eligible).toBe(false);
  });

  it('counts skill via explicit ack, not a live signal', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({
      member: { role: 'owner', created_at: nowIso, member_class: 'internal' },
      state: { skill_ack_at: nowIso, dismissed_at: null, celebrated_at: null },
      signals: NO_SIGNALS,
    }) } as Env;
    const s = await getOnboardingStatus(env, WS, U);
    expect(s?.tasks.find((t) => t.key === 'skill')?.done).toBe(true);
  });
});

describe('getPersonalOnboardingStatus', () => {
  it('returns null for an unknown user', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({ user: null }) } as Env;
    expect(await getPersonalOnboardingStatus(env, U)).toBeNull();
  });

  it('gives a fresh personal user the 4-task track at 0% and eligible', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({ user: { created_at: nowIso }, signals: { firstArtifact: 0, assistant: 0, shared: 0 } }) } as Env;
    const s = await getPersonalOnboardingStatus(env, U);
    expect(s?.track).toBe('personal');
    expect(s?.tasks.map((t) => t.key)).toEqual(['first_artifact', 'try_assistant', 'share_page', 'skill']);
    expect(s?.pct).toBe(0);
    expect(s?.eligible).toBe(true);
  });

  it('counts each done personal signal toward pct (2 of 4 = 50%)', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({ user: { created_at: nowIso }, signals: { firstArtifact: 1, assistant: 1, shared: 0 } }) } as Env;
    const s = await getPersonalOnboardingStatus(env, U);
    expect(s?.pct).toBe(50);
  });

  it('counts the skill task from an explicit ack', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({
      user: { created_at: nowIso },
      state: { skill_ack_at: nowIso, dismissed_at: null, celebrated_at: null },
      signals: { firstArtifact: 0, assistant: 0, shared: 0 },
    }) } as Env;
    const s = await getPersonalOnboardingStatus(env, U);
    expect(s?.tasks.find((t) => t.key === 'skill')?.done).toBe(true);
    expect(s?.pct).toBe(25);
  });

  it('is not eligible for an account older than the 14-day window', async () => {
    const env = { ...INTEGRATIONS, DB: makeDb({ user: { created_at: oldIso }, signals: { firstArtifact: 0, assistant: 0, shared: 0 } }) } as Env;
    const s = await getPersonalOnboardingStatus(env, U);
    expect(s?.eligible).toBe(false);
  });
});
