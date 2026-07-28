import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const quickSearch = vi.hoisted(() => vi.fn());
const runAgentTurn = vi.hoisted(() => vi.fn());
const recordAiUsage = vi.hoisted(() => vi.fn());
vi.mock('../../../src/search/quick-search', () => ({ quickSearch }));
vi.mock('../../../src/chat-agent/agent-loop', () => ({ runAgentTurn }));
vi.mock('../../../src/data/ai-usage', () => ({ recordAiUsage }));

import { askWorkspace } from '../../../src/search/ask-workspace';

const env = { BUILD_MODEL: 'test-model' } as unknown as Env;

const emptyGroups = { folders: [], datasets: [], connectors: [], people: [], schedules: [], crew: [], alerts: [] };
function hit(id: string, title: string, slug: string) {
  return { kind: 'artifact' as const, id, title, slug, score: 1 };
}

beforeEach(() => {
  quickSearch.mockReset();
  runAgentTurn.mockReset();
  recordAiUsage.mockReset();
  recordAiUsage.mockResolvedValue(undefined);
});

describe('askWorkspace', () => {
  it('cites only the pages the answer references, with {artifact_id,title,url} shape', async () => {
    quickSearch.mockResolvedValue({ query: 'q', artifacts: [hit('art_1', 'Q3 Revenue', 'q3-revenue'), hit('art_2', 'Churn', 'churn')], ...emptyGroups });
    runAgentTurn.mockResolvedValue({ reply: 'Revenue climbed [1]. Nothing on churn.' });

    const res = await askWorkspace(env, 'user_1', 'wsp_1', 'how is revenue?');

    expect(res.answer).toContain('Revenue climbed');
    expect(res.citations).toEqual([{ artifact_id: 'art_1', title: 'Q3 Revenue', url: '/a/q3-revenue/' }]);
  });

  it('scopes retrieval and the turn to the requesting user + workspace, and records usage', async () => {
    quickSearch.mockResolvedValue({ query: 'q', artifacts: [hit('art_1', 'A', 'a')], ...emptyGroups });
    runAgentTurn.mockResolvedValue({ reply: 'see [1]' });

    await askWorkspace(env, 'user_1', 'wsp_1', 'q?');

    expect(quickSearch).toHaveBeenCalledWith(env, 'user_1', expect.objectContaining({ workspaceId: 'wsp_1', groups: ['artifacts'] }));
    expect(runAgentTurn).toHaveBeenCalledWith(env, expect.objectContaining({ userId: 'user_1', selectedWorkspaceId: 'wsp_1' }));
    expect(recordAiUsage).toHaveBeenCalledWith(env, expect.objectContaining({ workspaceId: 'wsp_1', userId: 'user_1', kind: 'ask_workspace' }));
  });

  it('returns no citations when the answer references nothing or an out-of-range marker', async () => {
    quickSearch.mockResolvedValue({ query: 'q', artifacts: [hit('art_1', 'A', 'a'), hit('art_2', 'B', 'b')], ...emptyGroups });
    runAgentTurn.mockResolvedValue({ reply: 'I could not find that. Maybe check [5].' });

    const res = await askWorkspace(env, 'user_1', 'wsp_1', 'q');
    expect(res.citations).toEqual([]);
  });
});
