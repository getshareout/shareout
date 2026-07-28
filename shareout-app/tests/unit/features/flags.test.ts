import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import {
  isFeatureEnabled,
  resolveEffectiveFlags,
  featureDisabledResponse,
  buildFeaturesPayload,
  webAgentBlockedMessage,
  webAgentUpgradeMarkdown,
} from '../../../src/features/flags';

// Minimal fake D1: routes the two queries flags.ts issues to canned rows.
function makeEnv(opts: {
  global?: Record<string, boolean>;
  workspace?: Record<string, boolean>;
  ownerTier?: string;
}): Env {
  const globalRow = opts.global ? { value: JSON.stringify(opts.global) } : null;
  const wsRow = opts.workspace !== undefined ? { feature_flags: JSON.stringify(opts.workspace) } : null;
  const ownerTier = opts.ownerTier ?? 'free';
  const DB = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('platform_config')) return globalRow;
              if (sql.includes('workspaces w JOIN users')) return { tier: ownerTier };
              if (sql.includes('FROM workspaces')) return wsRow;
              return null;
            },
          };
        },
      };
    },
  };
  // No SLUGS → cache is skipped, reads hit the fake DB directly.
  return { DB } as unknown as Env;
}

describe('feature flag resolver', () => {
  it('uses the registry default when there are no overrides', async () => {
    const env = makeEnv({});
    expect(await isFeatureEnabled(env, 'ai.crew', 'ws1')).toBe(true);
  });

  it('global override beats the registry default', async () => {
    const env = makeEnv({ global: { 'ai.crew': false } });
    expect(await isFeatureEnabled(env, 'ai.crew', null)).toBe(false);
    expect(await isFeatureEnabled(env, 'ai.crew', 'ws1')).toBe(false);
  });

  it('workspace override beats the global override', async () => {
    const env = makeEnv({ global: { 'ai.crew': false }, workspace: { 'ai.crew': true } });
    expect(await isFeatureEnabled(env, 'ai.crew', 'ws1')).toBe(true);
    // Personal (null workspace) still sees the global value.
    expect(await isFeatureEnabled(env, 'ai.crew', null)).toBe(false);
  });

  it('unknown keys fail open (never block a real feature)', async () => {
    const env = makeEnv({ global: { 'x.unknown': false } });
    expect(await isFeatureEnabled(env, 'x.unknown', 'ws1')).toBe(true);
  });

  it('resolveEffectiveFlags reports the source of each value', async () => {
    const env = makeEnv({ global: { 'dest.slack': false }, workspace: { 'ai.crew': false } });
    const eff = await resolveEffectiveFlags(env, 'ws1');
    expect(eff['ai.crew']).toEqual({ value: false, source: 'workspace' });
    expect(eff['dest.slack']).toEqual({ value: false, source: 'global' });
    expect(eff['ai.visitor_chat'].source).toBe('default');
  });

  it('buildFeaturesPayload lists disabled keys', async () => {
    const env = makeEnv({ workspace: { 'ai.crew': false, 'dest.slack': false } });
    const payload = await buildFeaturesPayload(env, 'ws1');
    expect(payload.scope.workspace_id).toBe('ws1');
    expect(payload.features['ai.crew']).toBe(false);
    expect(payload.disabled).toContain('ai.crew');
    expect(payload.disabled).toContain('dest.slack');
    expect(payload.disabled).not.toContain('ai.visitor_chat');
  });

  it('ai.web_agent is on by default', async () => {
    const env = makeEnv({});
    expect(await isFeatureEnabled(env, 'ai.web_agent', 'ws1')).toBe(true);
  });

  it('workspace override can disable ai.web_agent', async () => {
    const env = makeEnv({ workspace: { 'ai.web_agent': false } });
    expect(await isFeatureEnabled(env, 'ai.web_agent', 'ws1')).toBe(false);
  });

  it('resolveEffectiveFlags reports the registry default for ai.web_agent', async () => {
    const env = makeEnv({});
    const eff = await resolveEffectiveFlags(env, 'ws1');
    expect(eff['ai.web_agent']).toEqual({ value: true, source: 'default' });
  });
});

describe('webAgentBlockedMessage', () => {
  it('explains a workspace-level switch-off', async () => {
    const env = makeEnv({ workspace: { 'ai.web_agent': false } });
    const msg = await webAgentBlockedMessage(env, 'ws-abc');
    expect(msg).toContain('turned off for this workspace');
  });

  it('falls back to a neutral message with no overrides', async () => {
    const msg = await webAgentBlockedMessage(makeEnv({}), 'ws-abc');
    expect(msg).toContain('Admin → Features');
    expect(msg).not.toContain('upgrade');
  });
});

describe('featureDisabledResponse', () => {
  it('is a 403 with code, feature key and label', async () => {
    const res = featureDisabledResponse('ai.crew');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FEATURE_DISABLED');
    expect(body.feature).toBe('ai.crew');
    expect(body.feature_label).toBe('CrewAI agents');
    expect(body.docs).toBe('/v1/features');
  });
});
