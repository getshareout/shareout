import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { getUserRole } from '../artifacts';
import { createLogger, logError } from '../logging';
import { sendArtifactToSlack, userFacingSlackDeliveryError, type SlackDeliveryMode } from './send';
import { jsonWithApiErrors } from '../http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

const MODES: SlackDeliveryMode[] = ['message', 'snapshot', 'pdf', 'both'];

// POST /v1/artifacts/{id}/share/slack — one-shot delivery to a Slack channel via
// a workspace bot-token connection. Editors and owners may share.
export async function handleShareToSlack(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const role = await getUserRole(env, artifactId, user.id);
  if (!role) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  let body: {
    connection?: string;
    targetType?: 'channel' | 'dm';
    channelId?: string;
    slackUserId?: string;
    mode?: string;
    message?: string;
    waitMs?: number;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (!body.connection) {
    return json({ error: 'connection is required', code: 'VALIDATION_ERROR' }, 400);
  }
  const targetType = body.targetType || 'channel';

  // Channel posts require owner/editor; any viewer with access may DM themselves.
  if (targetType !== 'dm' && role !== 'owner' && role !== 'editor') {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  if (targetType === 'dm' ? !body.slackUserId : !body.channelId) {
    return json({
      error: targetType === 'dm' ? 'slackUserId is required for a DM' : 'channelId is required for a channel post',
      code: 'VALIDATION_ERROR',
    }, 400);
  }
  if (body.mode && !MODES.includes(body.mode as SlackDeliveryMode)) {
    return json({ error: `mode must be one of: ${MODES.join(', ')}`, code: 'VALIDATION_ERROR' }, 400);
  }

  const logger = createLogger(env, {
    scope: 'slack',
    event: 'artifact.share.slack',
    artifact_id: artifactId,
    connection: body.connection,
  });

  try {
    const result = await sendArtifactToSlack(env, artifactId, {
      connection: body.connection,
      targetType,
      channelId: body.channelId,
      slackUserId: body.slackUserId,
      mode: body.mode as SlackDeliveryMode | undefined,
      message: body.message,
      waitMs: typeof body.waitMs === 'number' ? body.waitMs : undefined,
    });

    if (!result.success) {
      logError(logger, 'slack artifact share failed', result.error ?? 'unknown');
      const facing = userFacingSlackDeliveryError(result.error);
      return json({ error: facing.message, code: facing.code }, facing.status);
    }
    return json({ delivered: true });
  } catch (err) {
    logError(logger, 'slack artifact share threw', err);
    const facing = userFacingSlackDeliveryError(err instanceof Error ? err.message : String(err));
    return json({ error: facing.message, code: facing.code }, facing.status);
  }
}
