// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';
import type { AuthUser } from '../../src/api-auth';
import { guidanceEntryForContext } from '../../src/workspace-context';
import { buildHomeSnapshot } from '../../src/router/api/home-agent';
import { buildWorkspaceSnapshot } from '../../src/router/api/workspace-agent';

const user: AuthUser = { id: 'usr_1', email: 'a@b.co', username: null };
const WS = 'wsp_g';
const GUIDANCE_HEADER = '## House rules (guidance)';

// Mirrors knowledge-trunk-injection's mockDb. Knowledge is kept OFF so the trunk stays
// absent and we isolate the guidance block. entryContent is the content returned for the
// context_entry file (null → the workspace has no matching entry file).
function mockDb(opts: { entry?: string | null; entryContent?: string | null } = {}): Env['DB'] {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes('enabled FROM knowledge_settings')) return { enabled: 0 };
          if (sql.includes('context_entry FROM workspaces')) return { context_entry: opts.entry ?? null };
          if (sql.includes("content FROM workspace_files"))
            return opts.entryContent ? { content: opts.entryContent } : null;
          if (sql.includes('slug FROM workspaces')) return { slug: 's' };
          if (sql.includes("namespace = 'knowledge'")) return null;
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { changes: 0 } }),
      }),
    }),
  } as unknown as Env['DB'];
}

describe('guidanceEntryForContext', () => {
  it('returns empty when the workspace has no entry file', async () => {
    const env = { DB: mockDb({ entryContent: null }) } as Env;
    expect(await guidanceEntryForContext(env, WS)).toBe('');
  });

  it('returns empty when the entry file is blank', async () => {
    const env = { DB: mockDb({ entry: 'voice.md', entryContent: '   ' }) } as Env;
    expect(await guidanceEntryForContext(env, WS)).toBe('');
  });

  it('returns the labeled block for the entry file', async () => {
    const env = { DB: mockDb({ entry: 'voice.md', entryContent: 'Write in a warm, plain voice.' }) } as Env;
    const block = await guidanceEntryForContext(env, WS);
    expect(block.startsWith(`${GUIDANCE_HEADER}\n`)).toBe(true);
    expect(block).toContain('Write in a warm, plain voice.');
  });

  it('trims the body at maxChars with an ellipsis', async () => {
    const env = { DB: mockDb({ entry: 'index.md', entryContent: 'y'.repeat(5000) }) } as Env;
    const block = await guidanceEntryForContext(env, WS, { maxChars: 100 });
    expect(block.endsWith('…')).toBe(true);
    expect(block.length).toBeLessThan(150);
  });
});

describe('agent snapshot guidance injection', () => {
  it('buildHomeSnapshot includes the guidance block when an entry file exists', async () => {
    const env = { DB: mockDb({ entry: 'index.md', entryContent: 'Always cite the source page.' }) } as Env;
    const snap = await buildHomeSnapshot(env, WS, user);
    expect(snap).toContain(GUIDANCE_HEADER);
    expect(snap).toContain('Always cite the source page.');
  });

  it('buildHomeSnapshot omits the guidance block when there is no entry file', async () => {
    const env = { DB: mockDb({ entryContent: null }) } as Env;
    const snap = await buildHomeSnapshot(env, WS, user);
    expect(snap).not.toContain(GUIDANCE_HEADER);
  });

  it('buildWorkspaceSnapshot includes the guidance block when an entry file exists', async () => {
    const env = { DB: mockDb({ entry: 'index.md', entryContent: 'Always cite the source page.' }) } as Env;
    const snap = await buildWorkspaceSnapshot(env, WS, user);
    expect(snap).toContain(GUIDANCE_HEADER);
    expect(snap).toContain('Always cite the source page.');
  });

  it('buildWorkspaceSnapshot omits the guidance block when there is no entry file', async () => {
    const env = { DB: mockDb({ entryContent: null }) } as Env;
    const snap = await buildWorkspaceSnapshot(env, WS, user);
    expect(snap).not.toContain(GUIDANCE_HEADER);
  });
});
