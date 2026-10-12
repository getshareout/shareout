import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { TurnInput } from '../../../src/chat-agent/agent-loop';

const quickSearch = vi.hoisted(() => vi.fn());
const runAgentTurn = vi.hoisted(() => vi.fn());
vi.mock('../../../src/search/quick-search', async (orig) => ({
  ...(await orig<typeof import('../../../src/search/quick-search')>()),
  quickSearch,
}));
vi.mock('../../../src/chat-agent/agent-loop', () => ({ runAgentTurn }));

import { askWorkspace } from '../../../src/search/ask-workspace';

const slugs: Record<string, string> = { art_read: 'formato-es-ar' };
const env = {
  BUILD_MODEL: 'test-model',
  DB: {
    prepare: () => ({
      bind: (...ids: string[]) => ({
        all: async () => ({ results: ids.map((id) => ({ id, name: `name of ${id}`, slug: slugs[id] ?? null })) }),
      }),
    }),
  },
} as unknown as Env;

const emptyGroups = { folders: [], datasets: [], connectors: [], people: [], schedules: [], crew: [], alerts: [] };
function hit(id: string, title: string, slug: string) {
  return { kind: 'artifact' as const, id, title, slug, score: 1 };
}

beforeEach(() => {
  quickSearch.mockReset();
  runAgentTurn.mockReset();
});

describe('askWorkspace', () => {
  it('cites only the pages the answer references, with {artifact_id,title,url} shape', async () => {
    quickSearch.mockResolvedValue({ query: 'q', artifacts: [hit('art_1', 'Q3 Revenue', 'q3-revenue'), hit('art_2', 'Churn', 'churn')], ...emptyGroups });
    runAgentTurn.mockResolvedValue({ reply: 'Revenue climbed [1]. Nothing on churn.' });

    const res = await askWorkspace(env, 'user_1', 'wsp_1', 'how is revenue?');

    expect(res.answer).toContain('Revenue climbed');
    expect(res.citations).toEqual([{ artifact_id: 'art_1', title: 'Q3 Revenue', url: '/a/q3-revenue/' }]);
  });

  it('scopes retrieval and the turn to the requesting user + workspace, as an ask_workspace usage turn', async () => {
    quickSearch.mockResolvedValue({ query: 'q', artifacts: [hit('art_1', 'A', 'a')], ...emptyGroups });
    runAgentTurn.mockResolvedValue({ reply: 'see [1]' });

    await askWorkspace(env, 'user_1', 'wsp_1', 'q?');

    expect(quickSearch).toHaveBeenCalledWith(env, 'user_1', expect.objectContaining({ workspaceId: 'wsp_1', groups: ['artifacts'] }));
    expect(runAgentTurn).toHaveBeenCalledWith(env, expect.objectContaining({ userId: 'user_1', selectedWorkspaceId: 'wsp_1' }));
    expect(runAgentTurn).toHaveBeenCalledWith(env, expect.objectContaining({ usageKind: 'ask_workspace' }));
  });

  it('returns no citations when the answer references nothing or an out-of-range marker', async () => {
    quickSearch.mockResolvedValue({ query: 'q', artifacts: [hit('art_1', 'A', 'a'), hit('art_2', 'B', 'b')], ...emptyGroups });
    runAgentTurn.mockResolvedValue({ reply: 'I could not find that. Maybe check [5].' });

    const res = await askWorkspace(env, 'user_1', 'wsp_1', 'q');
    expect(res.citations).toEqual([]);
  });

  it('cites pages the agent read and pages its searches found that the answer names', async () => {
    quickSearch.mockResolvedValue({ query: 'q', artifacts: [], ...emptyGroups });
    runAgentTurn.mockImplementation(async (_env: Env, input: TurnInput) => {
      input.onToolResult?.('search_workspace', { query: 'fechas' }, { artifacts: [
        { id: 'art_found', name: 'KPIs', slug: 'kpis' },
        { id: 'art_unused', name: 'Roadmap', slug: 'roadmap' },
      ] });
      input.onToolResult?.('read_artifact', { artifact_id: 'art_read' }, { id: 'art_read', name: 'Formato es-AR', reportText: '' });
      input.onToolResult?.('read_artifact', { artifact_id: 'art_x' }, { error: 'You don’t have access to that page (or it doesn’t exist).' });
      return { reply: 'Usamos dd/mm/aaaa, según "Formato es-AR"; los kpis también.' };
    });

    const res = await askWorkspace(env, 'user_1', 'wsp_1', '¿qué formato de fecha usamos?');

    expect(res.citations).toEqual([
      { artifact_id: 'art_read', title: 'Formato es-AR', url: '/a/formato-es-ar/' },
      { artifact_id: 'art_found', title: 'KPIs', url: '/a/kpis/' },
    ]);
  });
});
