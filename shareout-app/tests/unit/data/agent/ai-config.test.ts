// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getInstanceDefaultGatewayModel, getWorkspaceByoConfig, resolveGatewayModel } from '../../../../src/data/agent/ai-config';
import { encryptCredentials } from '../../../../src/data/connections/credentials';
import type { Env } from '../../../../src/types';
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

describe('getWorkspaceByoConfig', () => {
  const KEY = 'x'.repeat(64);

  it('returns the decrypted workspace key as a provider config', async () => {
    const { encrypted, iv } = await encryptCredentials({ api_key: 'sk-ant-ws' }, KEY);
    const env = { ...makeEnv({ first: () => ({ byo_provider: 'anthropic', byo_encrypted_credentials: encrypted, byo_iv: iv }) }), CREDENTIALS_KEY: KEY } as Env;
    expect(await getWorkspaceByoConfig(env, 'wsp_1')).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant-ws' });
  });

  it('returns null without a BYO key, without CREDENTIALS_KEY, or when decrypt fails', async () => {
    expect(await getWorkspaceByoConfig(makeEnv({ first: () => null }), 'wsp_1')).toBeNull();
    const row = { byo_provider: 'openai', byo_encrypted_credentials: 'garbage', byo_iv: 'garbage' };
    expect(await getWorkspaceByoConfig(makeEnv({ first: () => row }), 'wsp_1')).toBeNull();
    expect(await getWorkspaceByoConfig({ ...makeEnv({ first: () => row }), CREDENTIALS_KEY: KEY } as Env, 'wsp_1')).toBeNull();
  });
});
