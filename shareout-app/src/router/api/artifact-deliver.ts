/** One-off "deliver now" — send an artifact to Slack / Telegram / Email immediately.
 *  Runs the same delivery registry the scheduler uses (src/delivery/), so there is no
 *  agent turn in the loop. Recurring sends go through POST /v1/jobs instead. */
import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { getDestination } from '../../delivery/registry';
import { executeJobAction } from '../../scheduling/jobs/runner';
import { checkViewerSelfDelivery } from '../../scheduling/jobs/permissions';
import type { JobAction, JobConfig } from '../../scheduling/jobs/types';
import { getUserRole } from '../../artifacts';
import { getLinkedChatId } from '../../telegram/linking';
import { resolveSlackTokenForArtifact } from '../../chat-platforms/slack/delivery';
import { listSlackChannels } from '../../chat-platforms/slack/client';
import { jsonResponse, jsonError } from '../helpers/json-response';

const DELIVER_NOW_ACTIONS: JobAction[] = ['email', 'slack', 'telegram'];

/** First Slack connection name for an artifact's workspace (the one Deliver uses), or null. */
async function firstSlackConnection(env: Env, workspaceId: string): Promise<string | null> {
  const conn = await env.DB.prepare(
    "SELECT name FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND provider = 'slack' ORDER BY created_at LIMIT 1"
  ).bind(workspaceId).first<{ name: string }>();
  return conn?.name || null;
}

async function artifactWorkspaceId(env: Env, artifactId: string): Promise<string | null> {
  const art = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  return art?.workspace_id || null;
}

/** GET — Slack channels for the artifact's workspace connection, so the UI can offer a picker. */
export async function handleDeliverSlackChannels(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string,
): Promise<Response> {
  const role = await getUserRole(env, artifactId, user.id);
  if (!role) return jsonError('Forbidden', 'FORBIDDEN', 403);
  const wsId = await artifactWorkspaceId(env, artifactId);
  if (!wsId) return jsonResponse({ channels: [] });
  const name = await firstSlackConnection(env, wsId);
  if (!name) return jsonResponse({ channels: [] });
  const resolved = await resolveSlackTokenForArtifact(env, artifactId, name);
  if (!resolved) return jsonResponse({ channels: [], error: 'Slack token unavailable' });
  try {
    const channels = await listSlackChannels(resolved.token);
    return jsonResponse({ channels: channels.map((c) => ({ id: c.id, name: c.name })) });
  } catch (e) {
    return jsonResponse({ channels: [], error: e instanceof Error ? e.message : 'Could not list channels' });
  }
}

/** GET — per-channel connection status for the Deliver UI, so it can offer a Connect button. */
export async function handleDeliverStatus(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string,
): Promise<Response> {
  const role = await getUserRole(env, artifactId, user.id);
  if (!role) return jsonError('Forbidden', 'FORBIDDEN', 403);

  const linked = await getLinkedChatId(env, user.id).catch(() => null);

  const wsId = await artifactWorkspaceId(env, artifactId);
  const slack: { available: boolean; connected: boolean; connectionName: string | null; connectUrl: string | null } =
    { available: !!wsId, connected: false, connectionName: null, connectUrl: null };
  if (wsId) {
    const name = await firstSlackConnection(env, wsId);
    if (name) { slack.connected = true; slack.connectionName = name; }
    else slack.connectUrl = `/v1/workspaces/${encodeURIComponent(wsId)}/connections/slack/install`;
  }

  return jsonResponse({
    telegram: { linked: linked != null, connectUrl: '/settings/telegram?go=1' },
    slack,
    email: { available: true },
  });
}

export async function handleDeliverNow(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { action?: string; config?: JobConfig } | null;
  const action = body?.action as JobAction | undefined;
  const config = body?.config;
  if (!action || !DELIVER_NOW_ACTIONS.includes(action)) {
    return jsonError('Unsupported delivery action', 'VALIDATION_ERROR', 400);
  }
  if (!config || typeof config !== 'object') {
    return jsonError('config is required', 'VALIDATION_ERROR', 400);
  }

  const role = await getUserRole(env, artifactId, user.id);
  if (!role) return jsonError('Forbidden', 'FORBIDDEN', 403);
  if (role === 'viewer') {
    const selfError = await checkViewerSelfDelivery(env, user.id, action, config);
    if (selfError) return jsonError(selfError, 'FORBIDDEN', 403);
  }

  const destination = getDestination(action);
  if (!destination) return jsonError('Unknown action', 'VALIDATION_ERROR', 400);
  const ctx = { artifactId, createdBy: user.id, triggeredVia: 'manual' as const };
  const configError = await destination.validate(env, ctx, config);
  if (configError) return jsonError(configError, 'VALIDATION_ERROR', 400);

  const result = await executeJobAction(env, action, artifactId, user.id, config, 'manual');
  if (!result.success) return jsonError(result.error || 'Delivery failed', 'DELIVERY_FAILED', 502);
  return jsonResponse({ success: true, steps: result.steps || [] });
}
