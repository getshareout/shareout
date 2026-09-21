// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getInstanceDefaultGatewayModel, resolveGatewayModel } from '../../../../src/data/agent/ai-config';
import { makeEnv } from './helpers';

describe('getInstanceDefaultGatewayModel', () => {
  it('returns the configured default', async () => {
    const env = makeEnv({ first: () => ({ default_gateway_model: 'deepseek/deepseek-v4.1-flash' }) });
    expect(await getInstanceDefaultGatewayModel(env)).toBe('deepseek/deepseek-v4.1-flash');
  });

  it('returns null when no row exists', async () => {
    const env = makeEnv({ first: () => null });
    expect(await getInstanceDefaultGatewayModel(env)).toBeNull();
  });
});

describe('resolveGatewayModel', () => {
  it('prefers the workspace override over the instance default', async () => {
    const env = makeEnv({
      first: (sql) =>
        sql.includes('workspace_llm_config')
          ? { gateway_model: 'openai/gpt-4o' }
          : { default_gateway_model: 'deepseek/deepseek-v4.1-flash' },
    });
    expect(await resolveGatewayModel(env, 'wsp_1')).toBe('openai/gpt-4o');
  });

  it('falls back to the instance default when the workspace has none', async () => {
    const env = makeEnv({
      first: (sql) =>
        sql.includes('workspace_llm_config')
          ? { gateway_model: null }
          : { default_gateway_model: 'deepseek/deepseek-v4.1-flash' },
    });
    expect(await resolveGatewayModel(env, 'wsp_1')).toBe('deepseek/deepseek-v4.1-flash');
  });

  it('returns null with no workspace and no instance default', async () => {
    const env = makeEnv({ first: () => null });
    expect(await resolveGatewayModel(env, null)).toBeNull();
  });
});
