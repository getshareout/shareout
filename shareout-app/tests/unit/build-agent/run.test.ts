// Which builds run as the agent (per-workspace flag, BUILD_AGENT force/kill) and what runPageBuild
// hands the agent: the workspace's model choice and its brand brief.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { makeDbMock } from '../data/agent/helpers';
import { scriptedProvider } from './helpers';

const getCrewProvider = vi.hoisted(() => vi.fn());
vi.mock('../../../src/crew/provider', async (importOriginal) => ({ ...(await importOriginal<object>()), getCrewProvider }));
vi.mock('../../../src/support/alert', () => ({ alertOps: vi.fn(async () => true) }));
vi.mock('../../../src/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }), logError: vi.fn() }));

import { BUILD_AGENT_FLAG, buildAgentEnabled, runPageBuild } from '../../../src/build-agent/run';

/** An env whose flags are: workspace overrides by id, and the global defaults map. */
function envWith(opts: { ws?: Record<string, Record<string, boolean>>; global?: Record<string, boolean>; llm?: Record<string, string | null>; instanceModel?: string | null; extra?: Partial<Env> } = {}): Env {
  const DB = makeDbMock({
    first: (sql, args) => {
      if (sql.includes('FROM workspaces WHERE id') && sql.includes('feature_flags')) {
        const f = opts.ws?.[args[0] as string];
        return f ? { feature_flags: JSON.stringify(f) } : null;
      }
      if (sql.includes('platform_config')) return opts.global ? { value: JSON.stringify(opts.global) } : null;
      if (sql.includes('workspace_llm_config')) return opts.llm && args[0] in opts.llm ? { gateway_model: opts.llm[args[0] as string] } : null;
      if (sql.includes('instance_ai_settings')) return { default_gateway_model: opts.instanceModel ?? null };
      if (sql.includes('FROM workspaces WHERE id') && sql.includes('branding')) return { branding: '{"accent_color":"#0156a4","logo_ext":"svg"}', locale: 'es' };
      return null;
    },
  });
  return { DB, SHAREOUT_BASE_URL: 'https://app.example', ...opts.extra } as unknown as Env;
}

describe('buildAgentEnabled', () => {
  it('is off by default', async () => {
    expect(await buildAgentEnabled(envWith(), 'wsA')).toBe(false);
    expect(await buildAgentEnabled(envWith(), null)).toBe(false);
  });

  it('follows the flag for the workspace it is on, and no other', async () => {
    const env = envWith({ ws: { wsA: { [BUILD_AGENT_FLAG]: true } } });
    expect(await buildAgentEnabled(env, 'wsA')).toBe(true);
    expect(await buildAgentEnabled(env, 'wsB')).toBe(false);
    expect(await buildAgentEnabled(env, null)).toBe(false);
  });

  it('a workspace can opt out of a global on, and personal builds follow the global flag', async () => {
    const env = envWith({ global: { [BUILD_AGENT_FLAG]: true }, ws: { wsA: { [BUILD_AGENT_FLAG]: false } } });
    expect(await buildAgentEnabled(env, 'wsA')).toBe(false);
    expect(await buildAgentEnabled(env, 'wsB')).toBe(true);
    expect(await buildAgentEnabled(env, null)).toBe(true);
  });

  it('BUILD_AGENT=on forces it everywhere', async () => {
    const env = envWith({ ws: { wsA: { [BUILD_AGENT_FLAG]: false } }, extra: { BUILD_AGENT: 'on' } });
    expect(await buildAgentEnabled(env, 'wsA')).toBe(true);
    expect(await buildAgentEnabled(env, null)).toBe(true);
  });

  it('BUILD_AGENT=off is a kill switch that beats every flag', async () => {
    const env = envWith({ global: { [BUILD_AGENT_FLAG]: true }, ws: { wsA: { [BUILD_AGENT_FLAG]: true } }, extra: { BUILD_AGENT: ' OFF ' } });
    expect(await buildAgentEnabled(env, 'wsA')).toBe(false);
    expect(await buildAgentEnabled(env, null)).toBe(false);
  });

  it('fails closed when the flag cannot be read', async () => {
    const DB = { prepare: () => { throw new Error('db down'); } };
    expect(await buildAgentEnabled({ DB } as unknown as Env, 'wsA')).toBe(false);
  });
});

describe('runPageBuild', () => {
  beforeEach(() => getCrewProvider.mockReset());

  const req = (env: Env, extra: Record<string, unknown> = {}) => ({
    env, user: { id: 'u1', email: 'a@x.com' }, meter: { workspaceId: 'wsA', userId: 'u1', kind: 'x', source: 'test' },
    locale: 'en' as const, prompt: 'a page', isPublic: false, publish: vi.fn(), ...extra,
  });

  it('builds on the workspace model choice (the one chat and crew use)', async () => {
    const { provider } = scriptedProvider([{ text: 'hi' }]);
    getCrewProvider.mockReturnValue(provider);
    await runPageBuild(req(envWith({ llm: { wsA: 'anthropic/claude-opus-5' }, instanceModel: 'anthropic/claude-haiku-4.5' })));
    expect(getCrewProvider.mock.calls[0][1]).toBe('anthropic/claude-opus-5');
  });

  it('falls back to the instance model, then to nothing (BUILD_MODEL / default apply downstream)', async () => {
    getCrewProvider.mockReturnValue(scriptedProvider([{ text: 'hi' }]).provider);
    await runPageBuild(req(envWith({ instanceModel: 'anthropic/claude-haiku-4.5' })));
    expect(getCrewProvider.mock.calls[0][1]).toBe('anthropic/claude-haiku-4.5');
    await runPageBuild(req(envWith()));
    expect(getCrewProvider.mock.calls[1][1]).toBeNull();
  });

  it('gives the agent the brief of the brief workspace, and the configured effort', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'hi' }]);
    getCrewProvider.mockReturnValue(provider);
    await runPageBuild(req(envWith({ extra: { BUILD_EFFORT: 'high' } }), { briefWorkspaceId: 'wsA' }));
    expect(calls[0].system).toContain('## This workspace');
    expect(calls[0].system).toContain('--so-color-primary:#0156a4');
    expect(calls[0].system).toContain('https://app.example/wl/wsA.svg');
    expect(calls[0].effort).toBe('high');
  });

  it('adds no workspace section without a brief workspace', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'hi' }]);
    getCrewProvider.mockReturnValue(provider);
    await runPageBuild(req(envWith()));
    expect(calls[0].system).not.toContain('This workspace');
    expect(calls[0].effort).toBe('medium');
  });

  it('returns null with no provider', async () => {
    getCrewProvider.mockReturnValue(null);
    expect(await runPageBuild(req(envWith()))).toBeNull();
  });
});
