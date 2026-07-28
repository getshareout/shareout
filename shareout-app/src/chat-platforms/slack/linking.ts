import type { Env } from '../../types';
import { PERSONAL_SCOPE, type WorkspaceSelection } from '../types';

export interface SlackSessionKey {
  teamId: string;
  userId: string;
}

/** messaging_links.session_key for Slack DMs: "{team_id}:{user_id}". */
export function slackSessionKey(teamId: string, userId: string): string {
  return `${teamId}:${userId}`;
}

export function parseSlackSessionKey(key: string): SlackSessionKey | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const teamId = key.slice(0, idx);
  const userId = key.slice(idx + 1);
  if (!teamId || !userId) return null;
  return { teamId, userId };
}

export interface SlackLinkRow {
  user_id: string;
  platform_user_id: string | null;
  team_id: string | null;
  connection_name: string | null;
  selected_workspace_id: string | null;
}

export async function linkSlackDm(
  env: Env,
  opts: {
    userId: string;
    teamId: string;
    slackUserId: string;
    connectionName: string;
    workspaceId: string;
  }
): Promise<void> {
  const sessionKey = slackSessionKey(opts.teamId, opts.slackUserId);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO messaging_links
      (platform, session_key, user_id, platform_user_id, team_id, connection_name, selected_workspace_id, linked_at)
     VALUES ('slack', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    sessionKey,
    opts.userId,
    opts.slackUserId,
    opts.teamId,
    opts.connectionName,
    opts.workspaceId,
    new Date().toISOString()
  ).run();
}

export async function getLinkedUserId(env: Env, teamId: string, slackUserId: string): Promise<string | null> {
  const sessionKey = slackSessionKey(teamId, slackUserId);
  const row = await env.DB.prepare(
    `SELECT user_id FROM messaging_links WHERE platform = 'slack' AND session_key = ?`
  ).bind(sessionKey).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function getSlackLink(
  env: Env,
  teamId: string,
  slackUserId: string
): Promise<SlackLinkRow | null> {
  const sessionKey = slackSessionKey(teamId, slackUserId);
  const row = await env.DB.prepare(
    `SELECT user_id, platform_user_id, team_id, connection_name, selected_workspace_id
     FROM messaging_links WHERE platform = 'slack' AND session_key = ?`
  ).bind(sessionKey).first<SlackLinkRow>();
  return row ?? null;
}

export async function getSelectedSlackWorkspace(
  env: Env,
  teamId: string,
  slackUserId: string
): Promise<WorkspaceSelection> {
  try {
    const link = await getSlackLink(env, teamId, slackUserId);
    return link?.selected_workspace_id ?? null;
  } catch {
    return null;
  }
}

export async function setSelectedSlackWorkspace(
  env: Env,
  teamId: string,
  slackUserId: string,
  workspaceId: WorkspaceSelection
): Promise<void> {
  const selected = workspaceId === PERSONAL_SCOPE ? PERSONAL_SCOPE : workspaceId;
  const sessionKey = slackSessionKey(teamId, slackUserId);
  try {
    await env.DB.prepare(
      `UPDATE messaging_links SET selected_workspace_id = ? WHERE platform = 'slack' AND session_key = ?`
    ).bind(selected, sessionKey).run();
  } catch {
    // Migration may not be applied yet.
  }
}

export async function unlinkSlackDm(env: Env, teamId: string, slackUserId: string): Promise<void> {
  const sessionKey = slackSessionKey(teamId, slackUserId);
  await env.DB.prepare(
    `DELETE FROM messaging_links WHERE platform = 'slack' AND session_key = ?`
  ).bind(sessionKey).run();
}

export async function countSlackLinks(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messaging_links WHERE platform = 'slack' AND user_id = ?`
  ).bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface SlackConnectionOption {
  workspaceId: string;
  workspaceName: string;
  connectionName: string;
}

/** Slack bot connections the user can link through (workspace member + slack provider). */
export async function listSlackConnectionsForUser(env: Env, userId: string): Promise<SlackConnectionOption[]> {
  const rows = await env.DB.prepare(
    `SELECT wc.scope_id AS workspace_id, wc.name AS connection_name, w.name AS workspace_name
     FROM connections wc
     JOIN workspace_members wm ON wm.workspace_id = wc.scope_id AND wm.user_id = ?
     JOIN workspaces w ON w.id = wc.scope_id
     WHERE wc.scope_type = 'workspace' AND wc.provider = 'slack'
     ORDER BY w.name, wc.name`
  ).bind(userId).all<SlackConnectionOption>();
  return rows.results;
}
