// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/chat-agent/access', () => ({ resolveArtifactAccessForUser: vi.fn() }));
vi.mock('../../../src/data/connections/query', () => ({ queryConnectionData: vi.fn(async () => [{ secret: 1 }]) }));

import { resolveArtifactAccessForUser } from '../../../src/chat-agent/access';
import { queryConnectionData } from '../../../src/data/connections/query';
import { runDataSourceTool } from '../../../src/chat-agent/tools/data-sources';
import type { Env } from '../../../src/types';

const input = { artifact_id: 'art_1', connection: 'api', query: 'GET /rows' };
const ctx = { env: {} as Env, userId: 'usr_1' };

describe('run_data_source under an access policy', () => {
  it('refuses a member scoped by the policy', async () => {
    vi.mocked(resolveArtifactAccessForUser).mockResolvedValue({
      workspaceId: 'ws_1', viewerScope: { field: 'company_id', values: [1] }, isWorkspaceMember: true, canRunConnections: true,
    } as never);
    const out = await runDataSourceTool.execute(ctx as never, input) as { error?: string };
    expect(out.error).toMatch(/row-level access policy/);
    expect(queryConnectionData).not.toHaveBeenCalled();
  });

  it('still runs for an unscoped member', async () => {
    vi.mocked(resolveArtifactAccessForUser).mockResolvedValue({
      workspaceId: 'ws_1', viewerScope: null, isWorkspaceMember: true, canRunConnections: true,
    } as never);
    const out = await runDataSourceTool.execute(ctx as never, input) as { data?: unknown };
    expect(out.data).toEqual([{ secret: 1 }]);
  });
});
