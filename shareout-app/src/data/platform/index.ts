import type { DataContext } from '../middleware';
import { createOAuthState, verifyOAuthState } from '../../oauth-state';

import { successResponse, errorResponse, verifyOwner, verifyWorkspaceConnectionAccess, verifyPerUserPlatformConnectionQuery, resolveRequesterUserId } from '../middleware';
import { PlatformEngine } from './core/engine';
import { getProvider, listProviders, hasProvider } from './registry';
import {
	listConnections,
	loadConnectionByName,
	createConnection,
	deleteConnection,
	verifyProxyToken,
} from './core/credentials';
import { PLATFORM_ERRORS } from './types';
import { validateReadOnlySql } from '../connections/sql-guard';
import { parseAccessPolicy } from '../access-policy';
import { findPolicyQuery } from './core/viewer-scope';
import { createLogger, logError } from '../../logging';
import { renderPlatformConnectionCallbackPage } from './callback-page';
import { mapPrepareFailure, platformOAuthDenialMessage, userFacingPlatformOAuthError } from './errors';

import './providers/google-sheets';
import './providers/google-analytics';
import './providers/shopify';
import './providers/tiendanube';
import './providers/bigquery';
import './providers/snowflake';
import './providers/slack';
import './providers/facebook-ads';
import './providers/google-ads';
import './providers/s3';
import './providers/supabase';
import './providers/redshift';
import './providers/aurora';

export { registerProvider, getProvider, listProviders, hasProvider } from './registry';
export { BaseProvider } from './providers/base-provider';
export { PlatformEngine } from './core/engine';
export { PlatformCache } from './core/cache';
export { PlatformRateLimiter, getRateLimiter } from './core/rate-limiter';
export * from './types';

function platformError(err: { code: string; message: string; httpStatus: number }, hint?: string) {
	return { code: err.code, message: err.message, status: err.httpStatus, hint };
}

function scopeRequired(provider: string, endpoint: string) {
	const e = PLATFORM_ERRORS.SCOPE_REQUIRED;
	return {
		success: false,
		error: { code: e.code, message: e.message, httpStatus: e.httpStatus, retryable: false },
		meta: { provider, endpoint, executionMode: 'proxy', cached: false, executionTimeMs: 0 },
	};
}

const METHOD_NOT_ALLOWED = { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 };

const SQL_PROVIDERS = new Set(['bigquery', 'snowflake', 'aurora', 'redshift', 'supabase']);

function sqlStatementsIn(value: unknown, key = '', depth = 0): string[] {
	if (typeof value === 'string') return /^(sql|query|statement|body)$/i.test(key) ? [value] : [];
	if (!value || typeof value !== 'object' || depth > 6) return [];
	return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => sqlStatementsIn(v, k, depth + 1));
}

function readsOnly(providerId: string, endpointId: string): boolean {
	if (SQL_PROVIDERS.has(providerId)) return true;
	const endpoint = getProvider(providerId)?.getEndpoint(endpointId);
	return !!endpoint && (endpoint.method === 'GET' || endpoint.readOnly === true);
}

const READ_ONLY_FORBIDDEN = {
	code: 'FORBIDDEN',
	message: "Your own connector credentials can only run read endpoints from someone else's page",
	status: 403,
};

export async function handlePlatformRequest(
	request: Request,
	ctx: DataContext,
	path: string[]
): Promise<Response> {
	const method = request.method;

	if (path.length === 0 || path[0] === 'providers') {
		if (method === 'GET') {
			return successResponse({ providers: listProviders() });
		}
		return errorResponse(METHOD_NOT_ALLOWED);
	}

	if (path[0] === 'connections') {
		return handleConnectionsRequest(request, ctx, path.slice(1));
	}

	if (path[0] === 'cache') {
		return handleCacheRequest(request, ctx, path.slice(1));
	}

	if (path[0] === 'usage') {
		return handleUsageRequest(request, ctx);
	}

	const providerId = path[0];
	if (!hasProvider(providerId)) {
		return errorResponse(platformError(
			PLATFORM_ERRORS.PROVIDER_NOT_FOUND,
			`Available providers: ${listProviders().map((p) => p.id).join(', ')}`
		));
	}

	return handleProviderRequest(request, ctx, providerId, path.slice(1));
}

async function handleConnectionsRequest(
	request: Request,
	ctx: DataContext,
	path: string[]
): Promise<Response> {
	const method = request.method;

	// Connections hold provider secrets (private keys, OAuth tokens). Mutations are
	// restricted to the artifact owner, even on public artifacts. Reads expose
	// connection ids/names that can be used to execute provider calls, so they are
	// owner-only too.
	if (!(await verifyOwner(request, ctx))) {
		return errorResponse({
			code: 'FORBIDDEN',
			message: 'Only the artifact owner can access platform connections',
			status: 403,
		});
	}

	if (path.length === 0) {
		if (method === 'GET') {
			const connections = await listConnections(ctx.env, ctx.artifactId);
			return successResponse({ connections });
		}

		if (method === 'POST') {
			const body = await request.json() as {
				name: string;
				provider: string;
				config: Record<string, unknown>;
				credentials: {
					access_token?: string;
					refresh_token?: string;
					expires_at?: number;
					extra?: Record<string, unknown>;
				};
				preferredMode?: 'direct' | 'proxy' | 'auto';
			};

			if (!body.name || !body.provider || !body.credentials) {
				return errorResponse({
					code: 'INVALID_REQUEST',
					message: 'Missing required fields: name, provider, credentials',
					status: 400,
				});
			}

			if (!hasProvider(body.provider)) {
				return errorResponse(platformError(
					PLATFORM_ERRORS.PROVIDER_NOT_FOUND,
					`Available providers: ${listProviders().map((p) => p.id).join(', ')}`
				));
			}

			const id = await createConnection(ctx.env, ctx.artifactId, {
				name: body.name,
				provider: body.provider,
				config: body.config || {},
				credentials: {
					// Key-pair providers (Snowflake, BigQuery service-account) carry
					// secrets in `extra`; OAuth providers use access_token.
					access_token: body.credentials.access_token || '',
					refresh_token: body.credentials.refresh_token,
					expires_at: body.credentials.expires_at,
					extra: body.credentials.extra,
				},
				preferredMode: body.preferredMode,
			});

			return successResponse({ id, name: body.name }, 201);
		}

		return errorResponse(METHOD_NOT_ALLOWED);
	}

	const connectionName = decodeURIComponent(path[0]);

	if (method === 'GET') {
		try {
			const connection = await loadConnectionByName(ctx.env, ctx.artifactId, connectionName);
			return successResponse({
				id: connection.id,
				name: connection.name,
				provider: connection.provider,
				preferredMode: connection.preferredMode,
				config: connection.config,
				createdAt: connection.createdAt,
				updatedAt: connection.updatedAt,
			});
		} catch {
			return errorResponse(platformError(PLATFORM_ERRORS.CONNECTION_NOT_FOUND));
		}
	}

	if (method === 'DELETE') {
		try {
			const connection = await loadConnectionByName(ctx.env, ctx.artifactId, connectionName);
			await deleteConnection(ctx.env, ctx.artifactId, connection.id);
			return successResponse({ deleted: true });
		} catch {
			return errorResponse(platformError(PLATFORM_ERRORS.CONNECTION_NOT_FOUND));
		}
	}

	return errorResponse(METHOD_NOT_ALLOWED);
}

async function handleCacheRequest(
	request: Request,
	ctx: DataContext,
	path: string[]
): Promise<Response> {
	const method = request.method;
	const engine = new PlatformEngine({
		artifactId: ctx.artifactId,
		env: ctx.env,
		requestOrigin: ctx.origin || undefined,
	});

	if (path.length === 0 || path[0] === 'status') {
		if (method === 'GET') {
			const status = await engine.getCacheStatus();
			return successResponse(status);
		}
	}

	if (path[0] === 'refresh') {
		if (method === 'POST') {
			const body = await request.json().catch(() => ({})) as {
				provider?: string;
				endpoint?: string;
			};
			const result = await engine.refreshCache(body.provider, body.endpoint);
			return successResponse(result);
		}
	}

	return errorResponse(METHOD_NOT_ALLOWED);
}

async function handleUsageRequest(request: Request, ctx: DataContext): Promise<Response> {
	if (request.method !== 'POST') {
		return errorResponse(METHOD_NOT_ALLOWED);
	}

	const body = await request.json().catch(() => ({})) as {
		provider: string;
		connectionId: string;
		endpoint: string;
		status: number;
		timestamp: number;
	};

	if (!body.provider || !body.connectionId) {
		return successResponse({ recorded: false });
	}

	const engine = new PlatformEngine({
		artifactId: ctx.artifactId,
		env: ctx.env,
	});

	engine.recordDirectUsage(body.provider, body.connectionId);

	return successResponse({ recorded: true });
}

export const ARTIFACT_OAUTH_STATE_PURPOSE = 'artifact-connection';

const OWNER_ONLY = { code: 'FORBIDDEN', message: 'Only the artifact owner can connect a provider', status: 403 };

async function handleProviderRequest(
	request: Request,
	ctx: DataContext,
	providerId: string,
	path: string[]
): Promise<Response> {
	const method = request.method;
	const provider = getProvider(providerId)!;

	if (path.length === 0) {
		if (method === 'GET') {
			return successResponse({
				config: provider.config,
				endpoints: provider.listEndpoints(),
			});
		}
		return errorResponse(METHOD_NOT_ALLOWED);
	}

	if (path[0] === 'auth-url') {
		if (method === 'GET') {
			if (!ctx.artifact.owner_id || !(await verifyOwner(request, ctx))) return errorResponse(OWNER_ONLY);
			const url = new URL(request.url);
			const connectionName = url.searchParams.get('connection');
			const returnUrl = url.searchParams.get('returnUrl') || '';

			const state = await createOAuthState(ctx.env, ARTIFACT_OAUTH_STATE_PURPOSE, ctx.artifact.owner_id, {
				artifactId: ctx.artifactId,
				connectionName,
				returnUrl,
			});

			const callbackUrl = `${url.origin}/v1/data/${ctx.artifactId}/platform/${providerId}/callback`;

			const authUrl = await provider.getAuthUrl({
				artifactId: ctx.artifactId,
				connectionId: '',
				callbackUrl,
				state,
				params: Object.fromEntries(url.searchParams),
				env: ctx.env,
			});

			return successResponse({ authUrl });
		}
		return errorResponse(METHOD_NOT_ALLOWED);
	}

	if (path[0] === 'callback') {
		if (method === 'GET') {
			const url = new URL(request.url);
			const denial = platformOAuthDenialMessage(url);
			if (denial) {
				return renderPlatformConnectionCallbackPage(false, providerId, denial);
			}

			const code = url.searchParams.get('code');
			const stateParam = url.searchParams.get('state');

			if (!code || !stateParam) {
				return renderPlatformConnectionCallbackPage(false, providerId, 'Missing code or state');
			}

			const ownerId = ctx.artifact.owner_id && (await verifyOwner(request, ctx)) ? ctx.artifact.owner_id : null;
			const state = await verifyOAuthState<{ artifactId: string; connectionName: string; returnUrl: string }>(ctx.env, stateParam, ARTIFACT_OAUTH_STATE_PURPOSE, ownerId);
			if (!state) {
				return renderPlatformConnectionCallbackPage(false, providerId, 'Invalid state');
			}

			if (state.artifactId !== ctx.artifactId) {
				return renderPlatformConnectionCallbackPage(false, providerId, 'State mismatch');
			}

			const callbackUrl = `${url.origin}/v1/data/${ctx.artifactId}/platform/${providerId}/callback`;

			try {
				const tokens = await provider.handleCallback(
					{
						artifactId: ctx.artifactId,
						connectionId: '',
						callbackUrl,
						state: stateParam,
						params: Object.fromEntries(url.searchParams),
						env: ctx.env,
					},
					code
				);

				if (state.connectionName) {
					const connectionConfig: Record<string, unknown> = {};
					if (providerId === 'shopify') {
						const shop = url.searchParams.get('shop');
						if (shop) {
							connectionConfig.shop = shop.replace('.myshopify.com', '');
						}
					}
					if (tokens.extra) {
						Object.assign(connectionConfig, tokens.extra);
					}

					await createConnection(ctx.env, ctx.artifactId, {
						name: state.connectionName,
						provider: providerId,
						config: connectionConfig,
						credentials: {
							access_token: tokens.accessToken,
							refresh_token: tokens.refreshToken,
							expires_at: tokens.expiresAt,
						},
					});
				}

				return renderPlatformConnectionCallbackPage(
					true,
					providerId,
					'Connected successfully. You can close this window.',
					state.returnUrl || undefined,
				);
			} catch (err) {
				logError(
					createLogger(ctx.env, {
						scope: 'platform',
						event: 'platform.oauth_callback.failed',
						artifact_id: ctx.artifactId,
						provider: providerId,
						connection: state.connectionName,
					}),
					'platform oauth callback failed',
					err,
				);
				return renderPlatformConnectionCallbackPage(
					false,
					providerId,
					userFacingPlatformOAuthError(providerId, err),
					state.returnUrl || undefined,
				);
			}
		}
		return errorResponse(METHOD_NOT_ALLOWED);
	}

	if (path[0] === 'prepare') {
		if (method === 'POST') {
			const body = await request.json() as {
				connectionId: string;
				endpoint: string;
			};

			if (!body.connectionId || !body.endpoint) {
				return errorResponse({
					code: 'INVALID_REQUEST',
					message: 'Missing connectionId or endpoint',
					status: 400,
				});
			}

			const requesterUserId = await resolveRequesterUserId(request, ctx);
			if (
				!(await verifyOwner(request, ctx)) &&
				!(await verifyWorkspaceConnectionAccess(request, ctx, body.connectionId))
			) {
				const perUser = await verifyPerUserPlatformConnectionQuery(request, ctx, body.connectionId);
				if (perUser === 'credentials_required') {
					return errorResponse({
						code: 'CREDENTIALS_REQUIRED',
						message: 'Connect your credentials for this connector before querying',
						status: 403,
						hint: 'Save your token via PUT /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials',
					});
				}
				if (perUser !== 'allowed') {
					return errorResponse({
						code: 'FORBIDDEN',
						message: 'You must be a member of this workspace (or the artifact owner) to prepare this connection',
						status: 403,
					});
				}
				if (!readsOnly(providerId, body.endpoint)) return errorResponse(READ_ONLY_FORBIDDEN);
			}

			const engine = new PlatformEngine({
				artifactId: ctx.artifactId,
				env: ctx.env,
				requestOrigin: ctx.origin || undefined,
				viewerScope: ctx.viewerScope,
				requesterUserId,
			});

			try {
				const result = await engine.prepareForDirectMode(providerId, body.connectionId, body.endpoint);
				return successResponse(result);
			} catch (error) {
				logError(
					createLogger(ctx.env, {
						scope: 'platform',
						event: 'platform.prepare.failed',
						artifact_id: ctx.artifactId,
						provider: providerId,
						connection_id: body.connectionId,
						endpoint: body.endpoint,
					}),
					'platform prepare failed',
					error,
				);
				const failure = mapPrepareFailure(error);
				return errorResponse({
					code: failure.code,
					message: failure.message,
					status: failure.status,
				});
			}
		}
		return errorResponse(METHOD_NOT_ALLOWED);
	}

	const endpointMatch = path.join('/').match(/^(.+)\/execute$/);
	if (endpointMatch) {
		if (method === 'POST') {
			const endpointId = endpointMatch[1];
			const body = await request.json() as {
				connectionId?: string;
				proxyToken?: string;
				params?: Record<string, unknown>;
				query?: unknown;
			};

			// A named query declared in access_policy.queries. Scoped viewers may only run
			// these; the engine ignores their params and binds the scope server-side.
			const accessPolicy = parseAccessPolicy(ctx.artifact.access_policy);
			const policyQuery = typeof body.query === 'string' ? body.query : undefined;
			if (body.query !== undefined && policyQuery === undefined) {
				return errorResponse({ code: 'INVALID_REQUEST', message: '"query" must be the name of a declared query', status: 400 });
			}
			if (ctx.viewerScope && policyQuery === undefined) {
				return successResponse(scopeRequired(providerId, endpointId), 403);
			}
			const declared = policyQuery !== undefined
				? findPolicyQuery(accessPolicy, policyQuery, providerId, endpointId, body.connectionId)
				: null;
			if (policyQuery !== undefined && !declared) {
				if (ctx.viewerScope) return successResponse(scopeRequired(providerId, endpointId), 403);
				return errorResponse(platformError(PLATFORM_ERRORS.QUERY_NOT_FOUND));
			}

			let connectionId = declared?.connection ?? body.connectionId;
			let usedProxyToken = false;

			if (!ctx.viewerScope && !declared && body.proxyToken && !connectionId) {
				const tokenData = await verifyProxyToken(ctx.env, body.proxyToken);
				if (!tokenData) {
					return errorResponse({
						code: 'INVALID_TOKEN',
						message: 'Invalid or expired proxy token',
						status: 401,
					});
				}
				connectionId = tokenData.connectionId;
				usedProxyToken = true;
			}

			if (!connectionId) {
				return errorResponse({
					code: 'INVALID_REQUEST',
					message: 'Missing connectionId or proxyToken',
					status: 400,
				});
			}

			// Scoped viewers skip the membership gate: they can only reach a declared
			// query, whose connection and SQL the author chose.
			const requesterUserId = await resolveRequesterUserId(request, ctx);
			if (
				!usedProxyToken &&
				!ctx.viewerScope &&
				!(await verifyOwner(request, ctx)) &&
				!(await verifyWorkspaceConnectionAccess(request, ctx, connectionId))
			) {
				const perUser = await verifyPerUserPlatformConnectionQuery(request, ctx, connectionId);
				if (perUser === 'credentials_required') {
					return errorResponse({
						code: 'CREDENTIALS_REQUIRED',
						message: 'Connect your credentials for this connector before querying',
						status: 403,
						hint: 'Save your token via PUT /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials',
					});
				}
				if (perUser !== 'allowed') {
					return errorResponse({
						code: 'FORBIDDEN',
						message: 'You must be a member of this workspace (or the artifact owner) to execute this connection',
						status: 403,
					});
				}
				if (!readsOnly(providerId, endpointId)) return errorResponse(READ_ONLY_FORBIDDEN);
				const statements = SQL_PROVIDERS.has(providerId) ? sqlStatementsIn(body.params) : [];
				const unsafe = statements.find((sql) => !validateReadOnlySql(sql).ok);
				if (unsafe !== undefined) {
					return errorResponse({
						code: 'FORBIDDEN',
						message: "Your own connector credentials can only run a single read-only statement (one SELECT) from someone else's page",
						status: 403,
					});
				}
			}

			const engine = new PlatformEngine({
				artifactId: ctx.artifactId,
				env: ctx.env,
				requestOrigin: ctx.origin || undefined,
				viewerScope: ctx.viewerScope,
				accessPolicy,
				requesterUserId,
			});

			const result = await engine.execute({
				provider: providerId,
				endpoint: endpointId,
				connectionId,
				params: declared ? undefined : body.params,
				policyQuery,
			});

			return successResponse(result, result.success ? 200 : result.error?.httpStatus || 500);
		}
		return errorResponse(METHOD_NOT_ALLOWED);
	}

	return errorResponse({
		code: 'NOT_FOUND',
		message: `Unknown platform path: ${path.join('/')}`,
		status: 404,
	});
}
