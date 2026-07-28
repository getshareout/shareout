import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/superadmin/insights', () => ({
  getWorkspaceCosts: vi.fn(),
}));
vi.mock('../../src/telegram/client', () => ({
  sendMessage: vi.fn(),
}));

import { getWorkspaceCosts } from '../../src/superadmin/insights';
import { sendMessage } from '../../src/telegram/client';
import { sendWorkspaceCostDigest } from '../../src/observability';
import type { Env } from '../../src/types';

const blank = {
  workspaceId: null as string | null, name: '', storageBytes: 0, servedRequests: 0, jobRuns: 0, jobCpuMs: 0,
  tokens: 0, storageUsd: 0, servingUsd: 0, automationUsd: 0, aiUsd: 0, totalUsd: 0,
  costDeltaUsd: 0,
};

// ALERT_TELEGRAM_CHAT_ID set → resolveSuperadminTelegramChatIds returns it without touching D1;
// RATE_LIMIT_KV stub lets fireAlert's dedup gate pass through.
function makeEnv(): Env {
  return {
    ALERT_TELEGRAM_CHAT_ID: '999',
    RATE_LIMIT_KV: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
  } as unknown as Env;
}

afterEach(() => vi.clearAllMocks());

describe('sendWorkspaceCostDigest', () => {
  it('sends a digest listing workspaces whose cost clears the threshold', async () => {
    vi.mocked(getWorkspaceCosts).mockResolvedValue({
      days: 30,
      egressTracked: false,
      rows: [
        { ...blank, name: 'FreeBurner', totalUsd: 4.41, aiUsd: 4.2 },
        { ...blank, name: 'Tiny', totalUsd: 0.2 }, // below the $1 threshold → excluded
      ],
      totals: { ...blank, name: 'All workspaces', totalUsd: 4.61 },
    } as any);

    await sendWorkspaceCostDigest(makeEnv());

    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
    const text = vi.mocked(sendMessage).mock.calls[0][2];
    expect(text).toContain('Most expensive workspaces');
    expect(text).toContain('FreeBurner');
    expect(text).toContain('$4.41');
    expect(text).not.toContain('Tiny'); // under threshold
  });

  it('stays quiet when no workspace clears the threshold', async () => {
    vi.mocked(getWorkspaceCosts).mockResolvedValue({
      days: 30, egressTracked: false,
      rows: [{ ...blank, name: 'Acme', totalUsd: 0.4 }],
      totals: { ...blank, name: 'All workspaces', totalUsd: 0.4 },
    } as any);

    await sendWorkspaceCostDigest(makeEnv());
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
  });

  it('honors a custom COST_ALERT_THRESHOLD_USD', async () => {
    vi.mocked(getWorkspaceCosts).mockResolvedValue({
      days: 30, egressTracked: false,
      rows: [{ ...blank, name: 'Small', totalUsd: 2 }],
      totals: { ...blank, name: 'All workspaces', totalUsd: 2 },
    } as any);

    const env = makeEnv();
    env.COST_ALERT_THRESHOLD_USD = '5'; // $2 of cost is under the $5 bar
    await sendWorkspaceCostDigest(env);
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
  });
});
