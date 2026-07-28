/**
 * Slack-specific workspace connector routes.
 * Slack uses a fixed callback URI registered in the Slack app (not per-workspace).
 */
import type { Env } from '../../../types';
import type { AuthUser } from '../../../api-auth';
import { createLogger, logError } from '../../../logging';
import { getProvider } from '../../../data/platform';
import { resolveSlackToken, listSlackChannels, isSlackAuthError } from '../../../slack/send';
import { renderWorkspaceConnectionCallbackPage } from './callback-page';
import { oauthDenialMessage, userFacingWorkspaceOAuthError } from './errors';
import { json, requireAdmin, requireMember, validateName } from './shared';
import { persistWorkspaceOAuthConnection } from './oauth';
import { getPlatformOrigin } from '../../../config/origins';

/** Fixed Slack OAuth redirect path (workspaceId travels in state). */
const SLACK_REDIRECT_PATH = '/v1/oauth/slack/callback';

/** Pin redirect_uri to the canonical apex host registered in the Slack app. */
function slackCallbackUrl(env: Env): string {
  const base = getPlatformOrigin(env);
  return `${base}${SLACK_REDIRECT_PATH}`;
}

// GET /v1/workspaces/{id}/connections/slack/install — start Slack OAuth (302)
export async function handleSlackInstall(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  if (!env.SLACK_CLIENT_ID) {
    return json({ error: 'SLACK_CLIENT_ID not configured', code: 'CONFIG_ERROR' }, 500);
  }

  const url = new URL(request.url);
  const connectionName = url.searchParams.get('connection') || 'slack';
  if (validateName(connectionName)) {
    return json({ error: 'Invalid connection name', code: 'VALIDATION_ERROR' }, 400);
  }
  const returnUrl = url.searchParams.get('returnUrl') || '';

  const state = btoa(JSON.stringify({ workspaceId, connectionName, returnUrl, ts: Date.now() }));
  const callbackUrl = slackCallbackUrl(env);
  const provider = getProvider('slack')!;
  const authUrl = await provider.getAuthUrl({
    artifactId: '', connectionId: '', callbackUrl, state,
    params: Object.fromEntries(url.searchParams), env,
  });

  return Response.redirect(authUrl, 302);
}

// GET /v1/oauth/slack/callback — fixed Slack OAuth redirect target
export async function handleSlackOAuthCallback(
  request: Request,
  env: Env,
  createdBy: string | null
): Promise<Response> {
  const url = new URL(request.url);
  const denial = oauthDenialMessage(url);
  if (denial) {
    return renderWorkspaceConnectionCallbackPage(false, 'slack', denial);
  }

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!code || !stateParam) {
    return renderWorkspaceConnectionCallbackPage(false, 'slack', 'Missing code or state');
  }

  let state: { workspaceId: string; connectionName: string; returnUrl: string };
  try {
    state = JSON.parse(atob(stateParam));
  } catch {
    return renderWorkspaceConnectionCallbackPage(false, 'slack', 'Invalid state');
  }
  if (!state.workspaceId || !state.connectionName) {
    return renderWorkspaceConnectionCallbackPage(false, 'slack', 'Invalid state');
  }

  const callbackUrl = slackCallbackUrl(env);
  const provider = getProvider('slack')!;

  try {
    const tokens = await provider.handleCallback({
      artifactId: '', connectionId: '', callbackUrl, state: stateParam,
      params: Object.fromEntries(url.searchParams), env,
    }, code);

    if (env.CREDENTIALS_KEY) {
      await persistWorkspaceOAuthConnection(env, {
        workspaceId: state.workspaceId,
        connectionName: state.connectionName,
        providerId: 'slack',
        tokens,
        connectionConfig: { ...(tokens.extra || {}) },
        createdBy,
      });
    }

    return renderWorkspaceConnectionCallbackPage(
      true,
      'slack',
      'Slack connected successfully. You can close this window.',
      state.returnUrl || undefined,
    );
  } catch (err) {
    logError(
      createLogger(env, {
        scope: 'workspace-connections',
        event: 'slack.oauth_callback.failed',
        workspace_id: state.workspaceId,
        connection: state.connectionName,
      }),
      'slack oauth callback failed',
      err,
    );
    return renderWorkspaceConnectionCallbackPage(
      false,
      'slack',
      userFacingWorkspaceOAuthError('slack', err),
    );
  }
}

// GET /v1/workspaces/{id}/connections/{name}/slack/channels — list postable channels
export async function handleListSlackChannels(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  connectionName: string
): Promise<Response> {
  if (!(await requireMember(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const resolved = await resolveSlackToken(env, workspaceId, connectionName);
  if (!resolved) {
    return json({ error: 'Slack connection not found', code: 'NOT_FOUND' }, 404);
  }

  try {
    const channels = await listSlackChannels(resolved.token);
    return json({ channels });
  } catch (err) {
    const authError = isSlackAuthError(String(err));
    logError(
      createLogger(env, {
        scope: 'workspace-connections',
        event: authError ? 'slack.channels.auth_failed' : 'slack.channels.list_failed',
        workspace_id: workspaceId,
        connection: connectionName,
      }),
      authError ? 'slack channel list rejected (auth)' : 'slack channel list failed',
      err,
    );
    if (authError) {
      return json({
        error: 'Slack connection needs to be re-authorized. Reconnect from workspace settings.',
        code: 'SLACK_AUTH',
      }, 400);
    }
    return json({ error: 'Failed to list Slack channels', code: 'SLACK_ERROR' }, 502);
  }
}
