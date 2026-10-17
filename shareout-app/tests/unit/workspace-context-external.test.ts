// The /v1/skill workspace context doc is internal guidance: internal members get it,
// external members and non-members get nothing.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from './helpers/migrated-db';
import { getSkillWorkspaceContext } from '../../src/workspace-context';

const WS = 'wsp_ctxx';
const OWNER = 'usr_ctxx_owner';
const EXTERNAL = 'usr_ctxx_external';
const OTHER = 'usr_ctxx_other';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'o@example.com', 'o'), (?, 'x@example.com', 'x'), (?, 'n@example.com', 'n')").bind(OWNER, EXTERNAL, OTHER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Ctx', 'ctx-x', ?)").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_files (workspace_id, namespace, path, content) VALUES (?, 'context', 'house-rules.md', 'Internal pricing guidance')").bind(WS),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_ctxx_1', ?, ?, 'owner', 'internal'), ('wm_ctxx_2', ?, ?, 'admin', 'external')`).bind(WS, OWNER, WS, EXTERNAL),
  ]);
});

describe('getSkillWorkspaceContext', () => {
  it('serves the doc to an internal member only', async () => {
    expect(await getSkillWorkspaceContext(e, WS, EXTERNAL)).toBe('');
    expect(await getSkillWorkspaceContext(e, 'ctx-x', OTHER)).toBe('');
    expect(await getSkillWorkspaceContext(e, WS, OWNER)).toContain('house-rules.md');
  });
});
