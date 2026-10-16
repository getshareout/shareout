import type { Env, WorkspaceRole } from '../types';
import { PERSONAL_SCOPE, type WorkspaceSelection } from '../chat-platforms/types';

declare const verified: unique symbol;

/**
 * The workspace an account-agent turn acts in, checked once at the start of the turn.
 * `workspaceId` is set only when the user (or one of their linked accounts) is an
 * INTERNAL member of it; an external member's edge never yields a scope. Built only by
 * resolveAgentScope, so a tool holding one knows the check ran.
 */
export interface AgentScope {
  readonly selection: WorkspaceSelection;
  readonly workspaceId: string | null;
  readonly role: WorkspaceRole | null;
  readonly [verified]: true;
}

const ROLES: Record<number, WorkspaceRole> = { 3: 'owner', 2: 'admin', 1: 'member' };

/** The selected workspace id, or null for personal / all-pages scope. */
export function selectedWorkspace(selection: WorkspaceSelection | undefined): string | null {
  return typeof selection === 'string' && selection !== PERSONAL_SCOPE ? selection : null;
}

/** The internal role of the user (across linked accounts) in a workspace, or null. */
export async function internalAgentRole(env: Env, userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const row = await env.DB.prepare(
    `SELECT MAX(CASE wm.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END) AS rank
       FROM workspace_members wm
      WHERE wm.workspace_id = ? AND wm.member_class = 'internal'
        AND wm.user_id IN (SELECT id FROM users WHERE id = ? OR (identity_id = (SELECT identity_id FROM users WHERE id = ?) AND COALESCE(disabled, 0) = 0))`
  ).bind(workspaceId, userId, userId).first<{ rank: number | null }>();
  return row?.rank ? ROLES[row.rank] ?? null : null;
}

/** Verifies a chat selection. Null when a workspace is selected that the user is not an internal member of. */
export async function resolveAgentScope(
  env: Env,
  userId: string,
  selection: WorkspaceSelection | undefined,
): Promise<AgentScope | null> {
  const ws = selectedWorkspace(selection);
  const sel = selection ?? null;
  if (!ws) return { selection: sel, workspaceId: null, role: null } as AgentScope;
  const role = await internalAgentRole(env, userId, ws);
  return role ? ({ selection: sel, workspaceId: ws, role } as AgentScope) : null;
}

/**
 * The workspace id a tool may read, or null (no workspace selected, or not an internal
 * member). Uses the turn's verified scope when it matches; otherwise checks membership
 * itself, so a tool called outside runAgentTurn is still gated.
 */
export async function scopedWorkspaceId(ctx: {
  env: Env;
  userId: string;
  selectedWorkspaceId?: WorkspaceSelection;
  scope?: AgentScope;
}): Promise<string | null> {
  const ws = selectedWorkspace(ctx.selectedWorkspaceId);
  if (!ws) return null;
  if (ctx.scope && ctx.scope.workspaceId === ws) return ws;
  return (await internalAgentRole(ctx.env, ctx.userId, ws)) ? ws : null;
}
