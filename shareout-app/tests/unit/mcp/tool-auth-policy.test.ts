// Guard: every MCP tool declares how it is scoped (MCP_TOOL_POLICIES), and no tool lets a
// member of workspace A read or change workspace B when handed B's ids.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import { TOOLS, callTool } from '../../../src/mcp/tools';
import type { ToolContext } from '../../../src/mcp/tool-kit';
import { MCP_TOOL_POLICIES } from '../router/route-policies';

const A_USER = 'usr_mtp_a';
const B_USER = 'usr_mtp_b';
const WS_A = 'wsp_mtp_a';
const WS_B = 'wsp_mtp_b';
const ART_B = 'art_mtp_b';
const FLD_B = 'fld_mtp_b';
const B_MARKERS = ['Tenant B Workspace', 'Plan for B', 'b-owner@example.com'];
const A_TOKEN = 'so_' + '8'.repeat(64);

beforeAll(async () => {
  await applyMigrations();
  // Name an instance admin so the first-user bootstrap rule does not make A one.
  (e as { INSTANCE_ADMIN_EMAILS?: string }).INSTANCE_ADMIN_EMAILS = 'ops@example.com';
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'a@example.com', 'a'), (?, 'b-owner@example.com', 'b')").bind(A_USER, B_USER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Tenant A', 'mtp-a', ?), (?, 'Tenant B Workspace', 'mtp-b', ?)").bind(WS_A, A_USER, WS_B, B_USER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_mtp_1', ?, ?, 'owner', 'internal'), ('wm_mtp_2', ?, ?, 'owner', 'internal')")
      .bind(WS_A, A_USER, WS_B, B_USER),
    e.DB.prepare("INSERT INTO folders (id, workspace_id, owner_id, name, slug, created_by) VALUES (?, ?, ?, 'B folder', 'b-folder', ?)").bind(FLD_B, WS_B, B_USER, B_USER),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, folder_id) VALUES (?, ?, 'Plan for B', 'mtp-plan-b', 'workspace', ?, ?)")
      .bind(ART_B, B_USER, WS_B, FLD_B),
  ]);
  await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash) VALUES ('tok_mtp_a', 'user', ?, ?, ?)")
    .bind(A_USER, A_USER, await hashToken(A_TOKEN)).run();
});

type Prop = { type?: string; enum?: unknown[]; minimum?: number };

function argsFor(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const out: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(props)) {
    if (/workspace/.test(key)) out[key] = WS_B;
    else if (/artifact|^id$|page/.test(key) && p.type === 'string') out[key] = ART_B;
    else if (/folder/.test(key) && p.type === 'string') out[key] = FLD_B;
    else if (p.enum) out[key] = p.enum[0];
    else if (p.type === 'string') out[key] = /email/.test(key) ? 'someone@example.net' : 'probe';
    else if (p.type === 'integer' || p.type === 'number') out[key] = p.minimum ?? 1;
    else if (p.type === 'boolean') out[key] = false;
    else if (p.type === 'array') out[key] = [];
  }
  return out;
}

const ctx: ToolContext = { env: e, user: { id: A_USER, email: 'a@example.com', username: null }, origin: 'https://shareout.test', authorization: `Bearer ${A_TOKEN}` };

describe('MCP tool policies', () => {
  it('every registered tool declares a policy, and the list has no stale names', () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names.filter((n) => !MCP_TOOL_POLICIES[n]), 'Add the tool to MCP_TOOL_POLICIES in tests/unit/router/route-policies.ts').toEqual([]);
    expect(Object.keys(MCP_TOOL_POLICIES).filter((n) => !names.includes(n))).toEqual([]);
  });

  it('no tool returns or changes workspace B data for a member of A given B ids', async () => {
    const leaks: string[] = [];
    for (const tool of TOOLS) {
      const result = await callTool(ctx, tool.name, argsFor(tool.inputSchema));
      const text = JSON.stringify(result ?? {});
      for (const marker of B_MARKERS) if (text.includes(marker)) leaks.push(`${tool.name} returned "${marker}"`);
      if (MCP_TOOL_POLICIES[tool.name] !== 'self' && result && !result.isError) {
        const mentionsB = text.includes(WS_B) || text.includes(ART_B) || text.includes(FLD_B);
        if (mentionsB) leaks.push(`${tool.name} answered for a workspace B id without an error`);
      }
    }
    const b = await e.DB.prepare('SELECT name, visibility, folder_id, deleted_at FROM artifacts WHERE id = ?').bind(ART_B).first();
    expect(b).toEqual({ name: 'Plan for B', visibility: 'workspace', folder_id: FLD_B, deleted_at: null });
    const members = await e.DB.prepare('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?').bind(WS_B).first<{ n: number }>();
    expect(members?.n).toBe(1);
    const artifacts = await e.DB.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE workspace_id = ?').bind(WS_B).first<{ n: number }>();
    expect(artifacts?.n).toBe(1);
    expect(leaks).toEqual([]);
  }, 120_000);
});
