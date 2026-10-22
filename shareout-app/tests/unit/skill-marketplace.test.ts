import { describe, expect, it, vi } from 'vitest';
import { generateTypeMetadata, detectArtifactType } from '../../src/validation';
import { handleAddDefaultSkill, skillPublishVisibility, handleListSkills, handleVoteSkill, workspaceHasTeamsPlan, handleAttachAgentSkill, buildAgentSkillsDoc } from '../../src/skill-marketplace';
import type { AuthUser } from '../../src/api-auth';
import type { Env, FileEntry } from '../../src/types';

describe('generateTypeMetadata(skill)', () => {
  const md = `---
category: Design
tags: ui, branding
version: 1.2.0
summary: How we brand dashboards
---

# Brand skill

Body paragraph.

\`\`\`js
console.log('x');
\`\`\`
`;

  it('parses skill frontmatter into props', () => {
    const meta = generateTypeMetadata('skill', md, 'text/markdown').skill!;
    expect(meta.category).toBe('Design');
    expect(meta.tags).toEqual(['ui', 'branding']);
    expect(meta.version).toBe('1.2.0');
    expect(meta.summary).toBe('How we brand dashboards');
  });

  it('inherits markdown TOC + code-block detection', () => {
    const meta = generateTypeMetadata('skill', md, 'text/markdown').skill!;
    expect(meta.hasCodeBlocks).toBe(true);
    expect(meta.toc.some(t => t.text === 'Brand skill')).toBe(true);
  });

  it('falls back to the first paragraph when no summary frontmatter', () => {
    const meta = generateTypeMetadata('skill', '# Title\n\nFirst real paragraph here.\n', 'text/markdown').skill!;
    expect(meta.summary).toBe('First real paragraph here.');
  });
});

describe('detectArtifactType', () => {
  const mdFile: FileEntry = { path: 'guide.md', content: '# Hi', mime: 'text/markdown' };

  it('keeps a .md as markdown unless skill is explicit', () => {
    expect(detectArtifactType([mdFile], 'guide.md')).toBe('markdown');
  });

  it('returns skill when explicitly requested', () => {
    expect(detectArtifactType([mdFile], 'guide.md', 'skill')).toBe('skill');
  });
});

// Minimal D1 mock that tracks run() calls and returns canned first() rows by SQL.
function makeDb(opts: {
  rows: (sql: string, args: unknown[]) => unknown;
  changes: (sql: string, args: unknown[]) => number;
  onRun?: (sql: string, args: unknown[]) => void;
}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => opts.rows(sql, args) ?? null),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => {
          opts.onRun?.(sql, args);
          return { success: true, meta: { changes: opts.changes(sql, args) } };
        }),
      })),
    })),
  } as unknown as Env['DB'];
}

const user: AuthUser = { id: 'usr_1', email: 'm@example.com', username: null };

describe('handleVoteSkill', () => {
  it('upvotes idempotently and reports the count', async () => {
    let upvotes = 0;
    const updates: string[] = [];
    const env = {
      DB: makeDb({
        rows: (sql) => {
          if (sql.includes('FROM skill_marketplace WHERE artifact_id') && sql.includes('workspace_id, blocked')) {
            return { workspace_id: 'wsp_1', blocked: 0 };
          }
          if (sql.includes('SELECT role FROM workspace_members')) return { role: 'member' };
          if (sql.includes('SELECT upvote_count')) return { upvote_count: upvotes };
          return null;
        },
        changes: (sql) => (sql.startsWith('INSERT OR IGNORE INTO skill_votes') ? 1 : 1),
        onRun: (sql) => {
          if (sql.includes('UPDATE skill_marketplace SET upvote_count = upvote_count + 1')) { upvotes += 1; updates.push('inc'); }
        },
      }),
    } as unknown as Env;

    const res = await handleVoteSkill(env, user, 'art_skill', true);
    const body = await res.json() as { voted: boolean; upvotes: number };
    expect(res.status).toBe(200);
    expect(body.voted).toBe(true);
    expect(body.upvotes).toBe(1);
    expect(updates).toEqual(['inc']);
  });

  it('rejects a vote on a non-skill artifact', async () => {
    const env = {
      DB: makeDb({ rows: () => null, changes: () => 0 }),
    } as unknown as Env;
    const res = await handleVoteSkill(env, user, 'art_missing', true);
    expect(res.status).toBe(404);
  });
});

describe('handleAttachAgentSkill (per-user agent skills)', () => {
  const officialRow = { workspace_id: 'wsp_official', blocked: 0, official: 1 };
  const req = () => new Request('https://x/', { method: 'POST', body: JSON.stringify({ skill_artifact_id: 'art_off' }) });

  it('attaches an official skill and inserts into workspace_agent_skills', async () => {
    const inserts: string[] = [];
    const env = {
      DB: makeDb({
        rows: (sql) => {
          if (sql.includes('FROM skill_marketplace WHERE artifact_id')) return officialRow;
          if (sql.includes('COUNT(*) AS n FROM workspace_agent_skills')) return { n: 0 };
          if (sql.includes('MAX(version_no)')) return { v: 3 };
          return null;
        },
        changes: () => 1,
        onRun: (sql) => { if (sql.includes('INSERT OR IGNORE INTO workspace_agent_skills')) inserts.push(sql); },
      }),
    } as unknown as Env;
    const res = await handleAttachAgentSkill(req(), env, user, 'wsp_mine');
    expect(res.status).toBe(200);
    expect(inserts.length).toBe(1);
  });

  it('rejects once the per-agent skill limit is reached', async () => {
    const env = {
      DB: makeDb({
        rows: (sql) => {
          if (sql.includes('FROM skill_marketplace WHERE artifact_id')) return officialRow;
          if (sql.includes('COUNT(*) AS n FROM workspace_agent_skills')) return { n: 8 };
          return null;
        },
        changes: () => 0,
      }),
    } as unknown as Env;
    const res = await handleAttachAgentSkill(req(), env, user, 'wsp_mine');
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe('LIMIT_REACHED');
  });
});

describe('buildAgentSkillsDoc', () => {
  it('returns empty string when the user has no attached skills', async () => {
    const env = { DB: makeDb({ rows: () => null, changes: () => 0 }) } as unknown as Env;
    expect(await buildAgentSkillsDoc(env, 'wsp_mine', user.id)).toBe('');
  });
});


describe('private skills (G-kit-2)', () => {
  it('publish keeps an explicit private choice and defaults everything else to workspace', () => {
    expect(skillPublishVisibility('private')).toBe('private');
    expect(skillPublishVisibility('workspace')).toBe('workspace');
    expect(skillPublishVisibility('public')).toBe('workspace');
    expect(skillPublishVisibility(undefined)).toBe('workspace');
  });

  it("the catalog list hides other members' private skills", async () => {
    const sqls: string[] = [];
    const binds: unknown[][] = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...a: unknown[]) => {
            sqls.push(sql); binds.push(a);
            return { first: async () => ({ role: 'member' }), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
          },
        }),
      },
    } as unknown as Env;
    await handleListSkills(new Request('https://x/v1/workspaces/wsp_1/skills'), env, user, 'wsp_1');
    const i = sqls.findIndex((q) => q.includes('FROM skill_marketplace sm'));
    expect(sqls[i]).toContain("(a.visibility != 'private' OR a.owner_id = ?)");
    expect(binds[i].filter((b) => b === 'usr_1').length).toBeGreaterThanOrEqual(4);
  });
});

describe('workspace default skills (G-kit-1)', () => {
  function envFor(opts: { skillWorkspace?: string; role?: string; visibility?: string } = {}) {
    const defaultBinds: unknown[][] = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...a: unknown[]) => ({
            all: async () => {
              if (sql.includes('FROM workspace_default_skills')) {
                defaultBinds.push(a);
                return { results: [{ skill_artifact_id: 'sk1', skill_version_no: 2, name: 'Design kit' }] };
              }
              return { results: [] };
            },
            first: async () => {
              if (sql.includes('FROM skill_marketplace WHERE artifact_id')) return { workspace_id: opts.skillWorkspace ?? 'wsp_a', blocked: 0, official: 0 };
              if (sql.includes('FROM versions WHERE artifact_id = ? AND version_no')) return { id: 'ver1', entrypoint: 'SKILL.md' };
              if (sql.includes('FROM assets WHERE version_id')) return { r2_key: 'k1' };
              if (sql.includes('SELECT role FROM workspace_members')) return { role: opts.role ?? 'admin', member_class: 'internal' };
              if (sql.includes('SELECT visibility, owner_id FROM artifacts')) return { visibility: opts.visibility ?? 'workspace', owner_id: 'usr_1' };
              if (sql.includes('SELECT visibility FROM artifacts')) return { visibility: opts.visibility ?? 'workspace' };
              if (sql.includes('MAX(version_no)')) return { v: 2 };
              return null;
            },
            run: async () => ({ meta: { changes: 1 } }),
          }),
        }),
      },
      ARTIFACTS: { get: async () => ({ text: async () => 'DESIGN KIT RULES' }) },
    } as unknown as Env;
    return { env, defaultBinds };
  }

  it("injects the workspace's default skills for turns scoped to that workspace", async () => {
    const { env, defaultBinds } = envFor();
    const doc = await buildAgentSkillsDoc(env, 'wsp_a', 'usr_member');
    expect(doc).toContain('DESIGN KIT RULES');
    expect(defaultBinds[0][0]).toBe('wsp_a');
  });

  it('never injects them into personal turns', async () => {
    const { env, defaultBinds } = envFor();
    expect(await buildAgentSkillsDoc(env, '__personal', 'usr_member')).toBe('');
    expect(defaultBinds).toHaveLength(0);
  });

  it("skips a default skill that belongs to another workspace (no cross-workspace leak)", async () => {
    const { env } = envFor({ skillWorkspace: 'wsp_b' });
    expect(await buildAgentSkillsDoc(env, 'wsp_a', 'usr_member')).toBe('');
  });

  it('only workspace admins can attach a default skill', async () => {
    const { env } = envFor({ role: 'member' });
    const res = await handleAddDefaultSkill(new Request('https://x', { method: 'POST', body: JSON.stringify({ skill_artifact_id: 'sk1' }) }), env, user, 'wsp_a');
    expect(res.status).toBe(403);
  });

  it('refuses a private skill and a skill from another workspace', async () => {
    const body = JSON.stringify({ skill_artifact_id: 'sk1' });
    const priv = envFor({ visibility: 'private' });
    const r1 = await handleAddDefaultSkill(new Request('https://x', { method: 'POST', body }), priv.env, user, 'wsp_a');
    expect(r1.status).toBe(400);
    const other = envFor({ skillWorkspace: 'wsp_b' });
    const r2 = await handleAddDefaultSkill(new Request('https://x', { method: 'POST', body }), other.env, user, 'wsp_a');
    expect((await r2.json() as { code: string }).code).toBe('CROSS_WORKSPACE');
  });

  it('attaches for an admin', async () => {
    const { env } = envFor();
    const res = await handleAddDefaultSkill(new Request('https://x', { method: 'POST', body: JSON.stringify({ skill_artifact_id: 'sk1' }) }), env, user, 'wsp_a');
    expect(res.status).toBe(200);
  });
});
