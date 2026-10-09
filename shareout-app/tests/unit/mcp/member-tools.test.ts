// invite_members over MCP: email parsing, admin gate, already-members untouched,
// per-email plain-words results with a copyable join link.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/chat-agent/access', () => ({ listWorkspacesForUser: vi.fn() }));
vi.mock('../../../src/workspaces/members', () => ({
  handleInviteWorkspaceMembers: vi.fn(),
  handleListWorkspaceMembers: vi.fn(),
}));
vi.mock('../../../src/workspaces/invites-admin', () => ({
  handleListWorkspaceInvites: vi.fn(),
  handleResendWorkspaceInvite: vi.fn(),
  handleRevokeWorkspaceInvite: vi.fn(),
}));

import { callTool } from '../../../src/mcp/tools';
import { parseEmails } from '../../../src/mcp/member-tools';
import { listWorkspacesForUser } from '../../../src/chat-agent/access';
import { handleInviteWorkspaceMembers, handleListWorkspaceMembers } from '../../../src/workspaces/members';
import { handleResendWorkspaceInvite } from '../../../src/workspaces/invites-admin';
import { createSchema, e, resetData } from './setup';

const ctx = { env: e, user: { id: 'usr_1', email: 'ana@example.com', username: null }, origin: 'https://shareout.test', authorization: 'Bearer so_x' };
const WS = { id: 'wsp_acme', name: 'Acme', slug: 'acme', role: 'admin' as const, artifactCount: 0 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeAll(async () => {
  await createSchema();
  await e.DB.prepare(
    'CREATE TABLE IF NOT EXISTS workspace_invite_claims (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, email TEXT, claimed_at TEXT, created_at TEXT)'
  ).run();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetData();
  await e.DB.prepare('DELETE FROM workspace_invite_claims').run();
  vi.mocked(listWorkspacesForUser).mockResolvedValue([WS]);
  vi.mocked(handleListWorkspaceMembers).mockResolvedValue(json({ members: [{ email: 'bo@example.com', role: 'member' }] }));
});

describe('parseEmails', () => {
  it('accepts arrays, commas, new lines and "Name <email>"', () => {
    expect(parseEmails('a@x.com, B@y.com\nAna <c@z.org>; a@x.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.org']);
    expect(parseEmails(['d@x.com', 'nope'])).toEqual(['d@x.com']);
  });
});

describe('invite_members', () => {
  it('invites new people, leaves members alone, explains skips, and returns join links', async () => {
    await e.DB.prepare("INSERT INTO workspace_invite_claims (id, workspace_id, user_id, email, created_at) VALUES ('ic_1', 'wsp_acme', 'usr_c', 'cy@example.com', '2026-10-01T00:00:00.000Z')").run();
    vi.mocked(handleInviteWorkspaceMembers).mockResolvedValue(json({ results: [
      { email: 'cy@example.com', status: 'invited' },
      { email: 'di@other.org', status: 'skipped', reason: 'domain_not_allowed' },
    ] }));
    vi.mocked(handleResendWorkspaceInvite).mockResolvedValue(json({ ok: true, inviteUrl: 'https://shareout.test/invite/CODE' }));

    const r = (await callTool(ctx, 'invite_members', { emails: 'bo@example.com, cy@example.com\ndi@other.org' }))!;
    const text = r.content[0].text;
    expect(text).toContain('bo@example.com: already a member');
    expect(text).toContain('cy@example.com: invited as member');
    expect(text).toContain('https://shareout.test/invite/CODE');
    expect(text).toContain('certain email domains');

    const sent = await (vi.mocked(handleInviteWorkspaceMembers).mock.calls[0][0] as Request).json();
    expect(sent).toEqual({ emails: ['cy@example.com', 'di@other.org'], role: 'member' });
    const resendBody = await (vi.mocked(handleResendWorkspaceInvite).mock.calls[0][0] as Request).json();
    expect(resendBody).toEqual({ notify: false });
  });

  it('refuses plain members without calling the invite handler', async () => {
    vi.mocked(listWorkspacesForUser).mockResolvedValue([{ ...WS, role: 'member' }]);
    const r = (await callTool(ctx, 'invite_members', { emails: ['x@y.com'] }))!;
    expect(r.content[0].text).toMatch(/Only owners and admins/);
    expect(handleInviteWorkspaceMembers).not.toHaveBeenCalled();
  });
});
