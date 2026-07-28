// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';
import type { AuthUser } from '../../src/api-auth';
import { knowledgeTrunkForContext } from '../../src/knowledge-context';
import { buildHomeSnapshot } from '../../src/router/api/home-agent';
import { buildWorkspaceSnapshot } from '../../src/router/api/workspace-agent';
import { buildWorkspaceContextDoc } from '../../src/workspace-context';

const user: AuthUser = { id: 'usr_1', email: 'a@b.co', username: null };
const WS = 'wsp_kn';
const TRUNK_HEADER = '## What this workspace knows';

function overviewFile(body: string) {
  return {
    path: 'index.md',
    content: `---\nkind: overview\nid: ws.overview\ntitle: Overview\n---\n${body}`,
    source: 'consolidated',
    updated_at: '2026-07-01T00:00:00Z',
  };
}

function mockDb(opts: {
  enabled?: boolean;
  overviewBody?: string;
  contextFiles?: { name: string; content: string; updated_by: string | null; updated_at: string }[];
} = {}): Env['DB'] {
  const knowledgeFiles = opts.overviewBody ? [overviewFile(opts.overviewBody)] : [];
  const contextFiles = opts.contextFiles ?? [];
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes('enabled FROM knowledge_settings')) return { enabled: opts.enabled ? 1 : 0 };
          if (sql.includes('context_entry FROM workspaces')) return { context_entry: null };
          // F8: the trunk helper now reads ONLY the index.md row (getKnowledgeFile → .first()).
          if (sql.includes("namespace = 'knowledge'")) return knowledgeFiles[0] ?? null;
          return null;
        },
        all: async () => {
          // F8: the trunk helper must NOT scan every knowledge row anymore — if it does,
          // this throw fails the test. Context files still stream via .all().
          if (sql.includes("namespace = 'knowledge'"))
            throw new Error('trunk helper must not load the whole KB');
          if (sql.includes("namespace = 'context'")) return { results: contextFiles };
          return { results: [] };
        },
        run: async () => ({ success: true, meta: { changes: 0 } }),
      }),
    }),
  } as unknown as Env['DB'];
}

describe('knowledgeTrunkForContext', () => {
  it('returns empty when knowledge is disabled', async () => {
    const env = { DB: mockDb({ enabled: false, overviewBody: 'Acme is a chat app.' }) } as Env;
    expect(await knowledgeTrunkForContext(env, WS)).toBe('');
  });

  it('returns empty when enabled but no overview node exists', async () => {
    const env = { DB: mockDb({ enabled: true }) } as Env;
    expect(await knowledgeTrunkForContext(env, WS)).toBe('');
  });

  it('returns the labeled, trimmed overview body when present', async () => {
    const env = { DB: mockDb({ enabled: true, overviewBody: 'Acme is a chat app. Retention is the north star.' }) } as Env;
    const trunk = await knowledgeTrunkForContext(env, WS);
    expect(trunk.startsWith(`${TRUNK_HEADER}\n`)).toBe(true);
    expect(trunk).toContain('Acme is a chat app.');
    expect(trunk).toContain('Retention is the north star.');
  });

  it('F8: reads only the index.md row, never the whole KB', async () => {
    // mockDb throws on any `.all()` over the knowledge namespace; a body still coming back proves the
    // helper reads the single trunk row (getKnowledgeFile), not loadKnowledge over every node.
    const env = { DB: mockDb({ enabled: true, overviewBody: 'Only the trunk was read.' }) } as Env;
    const trunk = await knowledgeTrunkForContext(env, WS);
    expect(trunk).toContain('Only the trunk was read.');
  });

  it('caps the body at maxChars with an ellipsis', async () => {
    const env = { DB: mockDb({ enabled: true, overviewBody: 'x'.repeat(5000) }) } as Env;
    const trunk = await knowledgeTrunkForContext(env, WS, { maxChars: 100 });
    expect(trunk.endsWith('…')).toBe(true);
    expect(trunk.length).toBeLessThan(150);
  });
});

describe('buildHomeSnapshot trunk injection', () => {
  it('includes the trunk when knowledge is on and an overview exists', async () => {
    const env = { DB: mockDb({ enabled: true, overviewBody: 'Acme is a chat app.' }) } as Env;
    const snap = await buildHomeSnapshot(env, WS, user);
    expect(snap).toContain(TRUNK_HEADER);
    expect(snap).toContain('Acme is a chat app.');
  });

  it('omits the trunk when knowledge is off', async () => {
    const env = { DB: mockDb({ enabled: false }) } as Env;
    const snap = await buildHomeSnapshot(env, WS, user);
    expect(snap).not.toContain(TRUNK_HEADER);
  });
});

describe('buildWorkspaceSnapshot trunk injection', () => {
  it('includes the trunk when knowledge is on and an overview exists', async () => {
    const env = { DB: mockDb({ enabled: true, overviewBody: 'Acme is a chat app.' }) } as Env;
    const snap = await buildWorkspaceSnapshot(env, WS, user);
    expect(snap).toContain(TRUNK_HEADER);
    expect(snap).toContain('Acme is a chat app.');
  });

  it('omits the trunk when knowledge is off', async () => {
    const env = { DB: mockDb({ enabled: false }) } as Env;
    const snap = await buildWorkspaceSnapshot(env, WS, user);
    expect(snap).not.toContain(TRUNK_HEADER);
  });
});

describe('buildWorkspaceContextDoc trunk injection', () => {
  it('ships the trunk as a section even with no context files', async () => {
    const env = { DB: mockDb({ enabled: true, overviewBody: 'Acme is a chat app.' }) } as Env;
    const doc = await buildWorkspaceContextDoc(env, WS, 'Acme');
    expect(doc).toContain('# Acme — workspace context');
    expect(doc).toContain(TRUNK_HEADER);
    expect(doc).toContain('Acme is a chat app.');
  });

  it('omits the trunk when knowledge is off and there are no files', async () => {
    const env = { DB: mockDb({ enabled: false }) } as Env;
    expect(await buildWorkspaceContextDoc(env, WS, 'Acme')).toBe('');
  });
});
