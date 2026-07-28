import { DATA_ERRORS } from '../../types';
import type { DataContext } from '../middleware';
import { errorResponse, successResponse } from '../middleware';
import { verifySessionToken } from '../../token';
import { handleVisitorChat, handleConversations, handleVisitorConfig, getAgentConfig } from './visitor-chat';
import { handleAdminChat, handleAdminContext, handleApplyEdits, handlePublish } from './admin-chat';
import { handlePilot } from './pilot';
import { getUsage } from './usage';

export async function handleAgent(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const [action, id, subAction] = parts;

  switch (action) {
    case 'chat':
      return handleVisitorChat(request, ctx);

    case 'conversations':
      return handleConversations(request, ctx, id, subAction);

    case 'config':
      return handleVisitorConfig(request, ctx);

    case 'pilot':
      return handlePilot(request, ctx);

    case 'usage':
      return handleUsageEndpoint(request, ctx);

    case 'admin':
      return handleAdminEndpoint(request, ctx, parts.slice(1));

    default:
      return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  }
}

async function handleUsageEndpoint(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
  }

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || undefined;

  const usage = await getUsage(ctx.env, ctx.artifactId, period);

  return successResponse({
    period: period || new Date().toISOString().slice(0, 7),
    usage,
  }, 200, ctx.origin);
}

async function handleAdminEndpoint(
  request: Request,
  ctx: DataContext,
  parts: string[]
): Promise<Response> {
  const [action, id] = parts;

  // Agent admin can be used by owners and editor collaborators, but only after
  // cryptographic session/API-token verification.
  if (!await verifyAgentAdminAccess(request, ctx)) {
    return errorResponse(DATA_ERRORS.FORBIDDEN, ctx.origin);
  }

  switch (action) {
    case 'context':
      return handleAdminContext(request, ctx);

    case 'chat':
      return handleAdminChat(request, ctx);

    case 'apply':
      return handleApplyEdits(request, ctx);

    case 'publish':
      return handlePublish(request, ctx);

    case 'config':
      return handleAdminConfig(request, ctx);

    default:
      return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  }
}

async function handleAdminConfig(request: Request, ctx: DataContext): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
  }

  let body: { pilot_enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' }, ctx.origin);
  }

  if (typeof body.pilot_enabled !== 'boolean') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'pilot_enabled must be a boolean' }, ctx.origin);
  }

  const pilotEnabled = body.pilot_enabled ? 1 : 0;
  await ctx.env.DB.prepare(`
    INSERT INTO artifact_agent_config (artifact_id, pilot_enabled)
    VALUES (?, ?)
    ON CONFLICT(artifact_id) DO UPDATE SET
      pilot_enabled = excluded.pilot_enabled,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(ctx.artifactId, pilotEnabled).run();

  const config = await getAgentConfig(ctx);
  return successResponse({ config, pilot_enabled: !!config?.pilot_enabled }, 200, ctx.origin);
}

async function verifyAgentAdminAccess(request: Request, ctx: DataContext): Promise<boolean> {
  const sessionToken = request.headers.get('Cookie')?.match(/shareout_session=([^;]+)/)?.[1];
  if (sessionToken) {
    const payload = await verifySessionToken(sessionToken, ctx.env);
    if (payload?.userId) {
      return userCanAdminAgent(ctx, payload.userId);
    }
  }

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const tokenHash = await hashToken(authHeader.slice(7));
    const tokenRow = await ctx.env.DB.prepare(`
      SELECT user_id FROM tokens
       WHERE token_hash = ? AND principal_type = 'user' AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `).bind(tokenHash).first<{ user_id: string }>();
    if (tokenRow?.user_id) {
      return userCanAdminAgent(ctx, tokenRow.user_id);
    }
  }

  return false;
}

async function userCanAdminAgent(ctx: DataContext, userId: string): Promise<boolean> {
  const artifact = await ctx.env.DB.prepare(`
    SELECT owner_id FROM artifacts WHERE id = ?
  `).bind(ctx.artifactId).first<{ owner_id: string | null }>();

  if (artifact?.owner_id === userId) {
    return true;
  }

  const collab = await ctx.env.DB.prepare(`
    SELECT role FROM collaborators
    WHERE artifact_id = ? AND user_id = ? AND role IN ('owner', 'editor')
  `).bind(ctx.artifactId, userId).first();

  return !!collab;
}

async function hashToken(token: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
