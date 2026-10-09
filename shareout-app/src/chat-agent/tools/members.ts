/**
 * People tools — list the current workspace's members and invite new ones from chat.
 * Admin/owner only. invite_members proposes; nothing is sent until the user confirms.
 */
import type { Env } from '../../types';
import type { AccountTool, ToolContext } from './types';
import type { PendingAction } from '../actions';
import { PERSONAL_SCOPE } from '../../chat-platforms/types';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { parseEmails } from '../../workspaces/parse-emails';

const NO_WORKSPACE = 'Members live in a workspace. Pick a workspace first, then ask again.';
const NOT_ADMIN = 'Only workspace owners and admins can see or invite members.';

function workspaceId(ctx: ToolContext): string | null {
  const ws = ctx.selectedWorkspaceId;
  return typeof ws === 'string' && ws !== PERSONAL_SCOPE ? ws : null;
}

export async function isWorkspaceAdmin(env: Env, wsId: string, userId: string): Promise<boolean> {
  const role = await getInternalWorkspaceRole(env, wsId, userId);
  return role === 'owner' || role === 'admin';
}

export const listMembersTool: AccountTool = {
  name: 'list_members',
  description: 'List the people in the current workspace (email, name, role, whether they still have to accept the invite). Admin/owner only.',
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    const wsId = workspaceId(ctx);
    if (!wsId) return { error: NO_WORKSPACE };
    if (!(await isWorkspaceAdmin(ctx.env, wsId, ctx.userId))) return { error: NOT_ADMIN };
    const rows = await ctx.env.DB.prepare(`
      SELECT u.email, u.name, wm.role, (u.last_login_at IS NULL) AS pending
        FROM workspace_members wm JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ? AND wm.member_class = 'internal' AND u.is_service = 0
       ORDER BY wm.created_at LIMIT 500
    `).bind(wsId).all<{ email: string | null; name: string | null; role: string; pending: number }>();
    return { members: (rows.results || []).map((r) => ({ email: r.email, name: r.name, role: r.role, pending: !!r.pending })) };
  },
};

export const inviteMembersTool: AccountTool = {
  name: 'invite_members',
  description:
    'Invite people to the current workspace by email. Pass the addresses exactly as the user gave them (a list, or pasted text with commas, newlines or "Name <email>"). Role is member (default) or admin. Optional short personal message for the invite email. Admin/owner only. Shows the user the list to confirm before anything is sent.',
  input_schema: {
    type: 'object',
    properties: {
      emails: { type: 'array', items: { type: 'string' }, description: 'Email addresses (or pasted text containing them).' },
      role: { type: 'string', enum: ['member', 'admin'], description: 'Workspace role (default member).' },
      message: { type: 'string', description: 'Optional personal note included in the invite.' },
    },
    required: ['emails'],
  },
  async execute(ctx, input): Promise<{ __propose: PendingAction } | { error: string }> {
    const wsId = workspaceId(ctx);
    if (!wsId) return { error: NO_WORKSPACE };
    if (!(await isWorkspaceAdmin(ctx.env, wsId, ctx.userId))) return { error: NOT_ADMIN };
    const { emails, invalid } = parseEmails(input.emails);
    if (!emails.length) {
      return { error: invalid.length ? `These aren’t valid email addresses: ${invalid.join(', ')}` : 'Give me at least one email address.' };
    }
    const ws = await ctx.env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(wsId).first<{ name: string }>();
    const message = typeof input.message === 'string' ? input.message.trim().slice(0, 500) : '';
    return {
      __propose: {
        kind: 'invite_members',
        workspaceId: wsId,
        workspaceName: ws?.name || 'workspace',
        emails,
        role: input.role === 'admin' ? 'admin' : 'member',
        ...(message ? { message } : {}),
        ...(invalid.length ? { invalid } : {}),
      },
    };
  },
};
