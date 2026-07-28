import { describe, expect, it } from 'vitest';
import { isCreateEnabled, requireCreateEnabled, CREATE_FEATURE } from '../../../src/pages/create-gate';

function makeEnv(workspace?: Record<string, boolean>) {
  const wsRow = workspace !== undefined ? { feature_flags: JSON.stringify(workspace) } : null;
  const DB = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM workspaces')) return wsRow;
              if (sql.includes('platform_config')) return null;
              return null;
            },
          };
        },
      };
    },
  };
  return { DB } as any;
}

describe('create feature gate', () => {
  it('is off by default (registry defaultEnabled: false)', async () => {
    expect(await isCreateEnabled(makeEnv({}), 'wsp_test')).toBe(false);
    expect(await isCreateEnabled(makeEnv({}), null)).toBe(false);
  });

  it('blocks when ai.create is off for the workspace', async () => {
    const env = makeEnv({ [CREATE_FEATURE]: false });
    const res = await requireCreateEnabled(env, 'wsp_test');
    expect(res?.status).toBe(403);
    const body = await res!.json();
    expect(body.code).toBe('FEATURE_DISABLED');
    expect(body.feature).toBe(CREATE_FEATURE);
  });

  it('allows when the flag is on', async () => {
    const env = makeEnv({ [CREATE_FEATURE]: true });
    expect(await requireCreateEnabled(env, 'wsp_test')).toBeNull();
  });
});
