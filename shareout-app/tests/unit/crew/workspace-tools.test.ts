import { describe, it, expect, vi, beforeEach } from 'vitest';

const canView = vi.fn();
const role = vi.fn();
const kEnabled = vi.fn();
const search = vi.fn();
const miniDbFor: string[] = [];
vi.mock('../../../src/data/middleware', () => ({ canViewArtifact: (...a: unknown[]) => canView(...a) }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole: (...a: unknown[]) => role(...a) }));
vi.mock('../../../src/knowledge/store', () => ({ isKnowledgeEnabled: (...a: unknown[]) => kEnabled(...a) }));
vi.mock('../../../src/knowledge/corpus/search', () => ({ searchCorpus: (...a: unknown[]) => search(...a) }));
vi.mock('../../../src/data/minidb-client', () => ({
  createMiniDb: (_e: unknown, id: string) => {
    miniDbFor.push(id);
    return { prepare: () => ({ bind: () => ({ first: async () => ({ key: 'digest', value: '{"items":[1]}', updated_at: 't' }) }) }) };
  },
}));

import { workspaceDataReadTool } from '../../../src/crew/tools/workspace-data-read';
import { workspaceArtifactsTool } from '../../../src/crew/tools/workspace-artifacts';
import { knowledgeSearchTool } from '../../../src/crew/tools/knowledge-search';
import { CREW_TOOLS } from '../../../src/crew/tool-registry';

function ctx(artifactRow: unknown, rows: unknown[] = []) {
  const binds: unknown[][] = [];
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...a: unknown[]) => {
          binds.push(a);
          return {
            first: async () => (sql.includes('FROM users') ? { email: 'leo@x.com' } : artifactRow),
            all: async () => ({ results: rows }),
          };
        },
      }),
    },
  };
  return {
    c: { data: { env, artifactId: 'art_self', db: {}, viewerScope: 'x' }, principal: { ownerId: 'usr_leo', workspaceId: 'wsp_1', crewId: 'c', runId: 'r', artifactId: 'art_self' }, limits: {} } as never,
    binds,
  };
}
const art = (ws: string | null) => ({ id: 'art_t', name: 'Tablero', visibility: 'private', auth_method: null, workspace_id: ws, owner_id: 'usr_leo' });

beforeEach(() => { vi.clearAllMocks(); miniDbFor.length = 0; role.mockResolvedValue('member'); canView.mockResolvedValue(true); kEnabled.mockResolvedValue(true); });

describe('workspace_data_read', () => {
  it('is registered as a read tool', () => {
    for (const n of ['workspace_data_read', 'workspace_artifacts', 'knowledge_search']) expect(CREW_TOOLS[n]?.mode).toBe('read');
  });
  it('reads a json key from another artifact of the same workspace', async () => {
    const { c } = ctx(art('wsp_1'));
    const r = (await workspaceDataReadTool.execute(c, { artifact_id: 'art_t', json_key: 'digest' })) as { artifact: { id: string }; value: unknown };
    expect(r.artifact.id).toBe('art_t');
    expect(r.value).toEqual({ items: [1] });
    expect(miniDbFor).toEqual(['art_t']);
  });
  it('hides artifacts of another workspace', async () => {
    const { c } = ctx(art('wsp_other'));
    expect(await workspaceDataReadTool.execute(c, { artifact_id: 'art_t', json_key: 'digest' })).toEqual({ error: 'Artifact not found in this workspace.' });
    expect(miniDbFor).toEqual([]);
  });
  it('respects the owner access check', async () => {
    canView.mockResolvedValue(false);
    const { c } = ctx(art('wsp_1'));
    expect(await workspaceDataReadTool.execute(c, { artifact_id: 'art_t', json_key: 'digest' })).toEqual({ error: 'Artifact not found in this workspace.' });
    expect(miniDbFor).toEqual([]);
  });
  it('requires json_key or table', async () => {
    const { c } = ctx(art('wsp_1'));
    expect(await workspaceDataReadTool.execute(c, { artifact_id: 'art_t' })).toEqual({ error: 'Pass json_key or table.' });
  });
});

describe('workspace_artifacts', () => {
  it('scopes the query to the crew workspace and owner', async () => {
    const { c, binds } = ctx(null, [{ id: 'a' }]);
    const r = (await workspaceArtifactsTool.execute(c, { name_contains: 'Vencim' })) as { count: number };
    expect(r.count).toBe(1);
    const q = binds.find((b) => b[0] === 'wsp_1')!;
    expect(q.slice(0, 4)).toEqual(['wsp_1', 'usr_leo', 1, 'leo@x.com']);
    expect(q[4]).toBe('vencim');
  });
  it('does not expose workspace-visible artifacts to a non-member owner', async () => {
    role.mockResolvedValue(null);
    const { c, binds } = ctx(null, []);
    await workspaceArtifactsTool.execute(c, {});
    expect(binds.find((b) => b[0] === 'wsp_1')![2]).toBe(0);
  });
});

describe('knowledge_search (crew)', () => {
  it('searches as the crew owner in the crew workspace', async () => {
    search.mockResolvedValue({ hits: [{ cite: 'IS-08-01 — p.2', text: 't', source: { kind: 'page', id: 'a' }, url: 'https://u' }] });
    const { c } = ctx(null);
    const r = (await knowledgeSearchTool.execute(c, { query: 'extintores' })) as { passages: { cite: string }[] };
    expect(r.passages[0].cite).toBe('IS-08-01 — p.2');
    expect(search.mock.calls[0].slice(1, 4)).toEqual(['wsp_1', 'usr_leo', 'extintores']);
  });
  it('refuses when the owner is not an internal member', async () => {
    role.mockResolvedValue(null);
    const { c } = ctx(null);
    expect(await knowledgeSearchTool.execute(c, { query: 'x' })).toMatchObject({ error: expect.stringContaining('not a member') });
    expect(search).not.toHaveBeenCalled();
  });
  it('reports Knowledge off', async () => {
    kEnabled.mockResolvedValue(false);
    const { c } = ctx(null);
    expect(await knowledgeSearchTool.execute(c, { query: 'x' })).toMatchObject({ enabled: false });
  });
});
