// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

vi.mock('../../../src/workspaces', () => ({ isPublicShowcaseWorkspace: vi.fn() }));

import { resolveAllowOpen } from '../../../src/access/allow-open';
import { isPublicShowcaseWorkspace } from '../../../src/workspaces';

const showcase = isPublicShowcaseWorkspace as ReturnType<typeof vi.fn>;
const env = (extra: Partial<Env> = {}) => ({ ...extra }) as Env;

beforeEach(() => {
  showcase.mockResolvedValue(false);
});

describe('resolveAllowOpen', () => {
  it('allows public links when the instance has not disabled them', async () => {
    expect(await resolveAllowOpen(env(), 'usr_1', null)).toBe(true);
    expect(await resolveAllowOpen(env(), 'usr_1', 'wsp_1')).toBe(true);
  });

  it('denies public links when OPEN_VISIBILITY_DISABLED is set', async () => {
    expect(await resolveAllowOpen(env({ OPEN_VISIBILITY_DISABLED: '1' }), 'usr_1', 'wsp_1')).toBe(false);
  });

  it('showcase workspaces bypass the kill switch', async () => {
    showcase.mockResolvedValue(true);
    expect(await resolveAllowOpen(env({ OPEN_VISIBILITY_DISABLED: '1' }), 'usr_1', 'wsp_show')).toBe(true);
  });

  it('rollout allowlist bypasses the kill switch for a named user', async () => {
    const e = env({ OPEN_VISIBILITY_DISABLED: '1', PUBLIC_ROLLOUT_USERS: 'usr_early' });
    expect(await resolveAllowOpen(e, 'usr_early', 'wsp_1')).toBe(true);
    expect(await resolveAllowOpen(e, 'usr_other', 'wsp_1')).toBe(false);
  });
});
