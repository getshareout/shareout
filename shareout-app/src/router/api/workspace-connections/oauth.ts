/**
 * Platform OAuth flow for workspace connectors — auth URL, callback,
 * and encrypted token persistence.
 */
import type { Env } from '../../../types';
import type { AuthUser } from '../../../api-auth';
import type { TokenResult } from '../../../data/platform/types';
import { generateId } from '../../../crypto-utils';
import { encryptCredentials } from '../../../data/connections/credentials';
import { getProvider, hasProvider, listProviders } from '../../../data/platform';
import { createLogger, logError } from '../../../logging';
import { renderWorkspaceConnectionCallbackPage } from './callback-page';
import { oauthDenialMessage, userFacingWorkspaceOAuthError } from './errors';
import { json, requireAdmin, validateName } from './shared';

// GET /v1/workspaces/{id}/connections/{provider}/auth-url — start OAuth
export async function handleWorkspaceOAuthUrl(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  providerId: string
): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  if (!hasProvider(providerId)) {
    return json({
      error: 'Provider not found',
      code: 'PROVIDER_NOT_FOUND',
      available: listProviders().map((p) => p.id),
    }, 404);
  }

  const url = new URL(request.url);
  const connectionName = url.searchParams.get('connection');
  if (!connectionName || validateName(connectionName)) {
    return json({ error: 'Valid connection name required', code: 'VALIDATION_ERROR' }, 400);
  }
  const returnUrl = url.searchParams.get('returnUrl') || '';

  const state = btoa(JSON.stringify({ workspaceId, connectionName, returnUrl, ts: Date.now() }));
  const callbackUrl = `${url.origin}/v1/workspaces/${workspaceId}/connections/${providerId}/callback`;

  const provider = getProvider(providerId)!;
  const authUrl = await provider.getAuthUrl({
    artifactId: '',
    connectionId: '',
    callbackUrl,
    state,
    params: Object.fromEntries(url.searchParams),
    env,
  });

  return json({ authUrl });
}

// GET /v1/workspaces/{id}/connections/{provider}/callback — OAuth redirect target
export async function handleWorkspaceOAuthCallback(
  request: Request,
  env: Env,
  workspaceId: string,
  providerId: string,
  createdBy: string | null
): Promise<Response> {
  if (!hasProvider(providerId)) {
    return new Response('Unknown provider', { status: 404 });
  }

  const url = new URL(request.url);
  const denial = oauthDenialMessage(url);
  if (denial) {
    return renderWorkspaceConnectionCallbackPage(false, providerId, denial);
  }

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!code || !stateParam) {
    return renderWorkspaceConnectionCallbackPage(false, providerId, 'Missing code or state');
  }

  let state: { workspaceId: string; connectionName: string; returnUrl: string };
  try {
    state = JSON.parse(atob(stateParam));
  } catch {
    return renderWorkspaceConnectionCallbackPage(false, providerId, 'Invalid state');
  }

  if (state.workspaceId !== workspaceId) {
    return renderWorkspaceConnectionCallbackPage(false, providerId, 'State mismatch');
  }

  const callbackUrl = `${url.origin}/v1/workspaces/${workspaceId}/connections/${providerId}/callback`;
  const provider = getProvider(providerId)!;

  try {
    const tokens = await provider.handleCallback({
      artifactId: '',
      connectionId: '',
      callbackUrl,
      state: stateParam,
      params: Object.fromEntries(url.searchParams),
      env,
    }, code);

    if (state.connectionName && env.CREDENTIALS_KEY) {
      const connectionConfig: Record<string, unknown> = {};
      if (providerId === 'shopify') {
        const shop = url.searchParams.get('shop');
        if (shop) connectionConfig.shop = shop.replace('.myshopify.com', '');
      }
      if (tokens.extra) Object.assign(connectionConfig, tokens.extra);

      await persistWorkspaceOAuthConnection(env, {
        workspaceId,
        connectionName: state.connectionName,
        providerId,
        tokens,
        connectionConfig,
        createdBy,
      });
    }

    return renderWorkspaceConnectionCallbackPage(
      true,
      providerId,
      'Connected successfully. You can close this window.',
      state.returnUrl || undefined,
    );
  } catch (err) {
    logError(
      createLogger(env, {
        scope: 'workspace-connections',
        event: 'workspace.oauth_callback.failed',
        workspace_id: workspaceId,
        provider: providerId,
        connection: state.connectionName,
      }),
      'workspace oauth callback failed',
      err,
    );
    return renderWorkspaceConnectionCallbackPage(
      false,
      providerId,
      userFacingWorkspaceOAuthError(providerId, err),
    );
  }
}

/** Encrypt OAuth tokens and upsert a workspace-scoped platform connection. */
export async function persistWorkspaceOAuthConnection(
  env: Env,
  opts: {
    workspaceId: string;
    connectionName: string;
    providerId: string;
    tokens: TokenResult;
    connectionConfig: Record<string, unknown>;
    createdBy: string | null;
  }
): Promise<void> {
  const { encrypted, iv } = await encryptCredentials({
    access_token: opts.tokens.accessToken,
    refresh_token: opts.tokens.refreshToken,
    expires_at: opts.tokens.expiresAt,
    extra: opts.tokens.extra,
  }, env.CREDENTIALS_KEY!);

  await env.DB.prepare(`
    INSERT INTO connections (
      id, scope_type, scope_id, name, kind, provider, auth_type, config,
      encrypted_credentials, iv, preferred_mode, created_by
    ) VALUES (?, 'workspace', ?, ?, 'platform', ?, 'oauth2', ?, ?, ?, 'auto', ?)
    ON CONFLICT(scope_type, scope_id, name) DO UPDATE SET
      provider = excluded.provider,
      config = excluded.config,
      encrypted_credentials = excluded.encrypted_credentials,
      iv = excluded.iv,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(
    generateId('conn'), opts.workspaceId, opts.connectionName, opts.providerId,
    JSON.stringify(opts.connectionConfig), encrypted, iv, opts.createdBy
  ).run();
}
