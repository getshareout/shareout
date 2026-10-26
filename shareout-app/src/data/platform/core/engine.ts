import type {
	Env,
	PlatformRequest,
	PlatformResponse,
	ExecutionMode,
	DecryptedCredentials,
} from '../types';
import { PLATFORM_ERRORS } from '../types';
import { getProvider } from '../registry';
import { PlatformCache } from './cache';
import { getRateLimiter, type RateLimitResult } from './rate-limiter';
import {
	loadConnection,
	loadWorkspaceConnection,
	getDecryptedCredentials,
	prepareCredentialsForRequest,
	saveCredentials,
	type ResolvedConnection,
} from './credentials';
import { resolveExecutionMode } from '../execution/mode-resolver';
import { viewerScopeCacheKey, type AccessPolicy, type ViewerScope } from '../../access-policy';
import { bindPolicyQuery, findPolicyQuery } from './viewer-scope';

export interface EngineContext {
	artifactId: string;
	env: Env;
	requestOrigin?: string;
	// When set, the connection is resolved at the workspace level (no artifact
	// anchor). Used by the workspace-level assistant. Takes precedence over the
	// artifact-derived workspace lookup.
	workspaceId?: string;
	// The signed-in user making the request. Required for per_user connections so
	// each member's query resolves (and caches under) their own credentials.
	requesterUserId?: string | null;
	// Row-level access scope for the current viewer (0042). When set (non-owner
	// viewer under an access policy), the request must name a query declared in
	// `accessPolicy.queries`; the viewer's params are ignored and the scope is bound
	// into the declared SQL. Anything else fails closed. null/undefined = unscoped.
	viewerScope?: ViewerScope | null;
	// The artifact's access policy, source of the declared queries.
	accessPolicy?: AccessPolicy | null;
}

export class PlatformEngine {
	private cache: PlatformCache;

	constructor(private ctx: EngineContext) {
		this.cache = new PlatformCache(ctx.env, ctx.artifactId);
	}

	async execute<T = unknown>(request: PlatformRequest): Promise<PlatformResponse<T>> {
		const startTime = Date.now();

		const provider = getProvider(request.provider);
		if (!provider) {
			return this.errorResponse(PLATFORM_ERRORS.PROVIDER_NOT_FOUND, startTime);
		}

		const endpoint = provider.getEndpoint(request.endpoint);
		if (!endpoint) {
			return this.errorResponse(PLATFORM_ERRORS.ENDPOINT_NOT_FOUND, startTime);
		}

		// Declared queries: resolve before loading the connection, since the declaration
		// fixes the connection and params.
		if (request.policyQuery !== undefined || this.ctx.viewerScope) {
			const policy = this.ctx.accessPolicy;
			const query = policy && request.policyQuery !== undefined
				? findPolicyQuery(policy, request.policyQuery, request.provider, request.endpoint, request.connectionId || undefined)
				: null;
			if (!policy || !query) {
				return this.errorResponse(
					this.ctx.viewerScope ? PLATFORM_ERRORS.SCOPE_REQUIRED : PLATFORM_ERRORS.QUERY_NOT_FOUND,
					startTime
				);
			}
			const bound = bindPolicyQuery(query, policy, this.ctx.viewerScope ?? null);
			if (!bound.ok) return this.errorResponse(PLATFORM_ERRORS.SCOPE_REQUIRED, startTime);
			request = { ...request, connectionId: query.connection, params: bound.params };
		}

		let connection: ResolvedConnection;
		try {
			connection = this.ctx.workspaceId
				? await loadWorkspaceConnection(
						this.ctx.env,
						this.ctx.workspaceId,
						request.connectionId,
						this.ctx.requesterUserId
					)
				: await loadConnection(
						this.ctx.env,
						this.ctx.artifactId,
						request.connectionId,
						this.ctx.requesterUserId
					);
		} catch (err) {
			if (err instanceof Error && err.message === 'CREDENTIALS_REQUIRED') {
				return this.errorResponse(PLATFORM_ERRORS.CREDENTIALS_REQUIRED, startTime);
			}
			return this.errorResponse(PLATFORM_ERRORS.CONNECTION_NOT_FOUND, startTime);
		}

		const mode = resolveExecutionMode({
			provider: provider.config,
			endpoint,
			requestOrigin: this.ctx.requestOrigin,
			connectionConfig: connection,
			userPreference: request.options?.executionMode,
		});

		// Segment the cache per viewer scope. Per-user connections additionally segment the cache by user so one member's
		// cached rows are never served to another.
		// The connection (and workspace, for workspace-level calls) segments the cache too:
		// workspace-level calls share one store, and two connections of one provider differ.
		let scopeKey = `c:${connection.id}|w:${this.ctx.workspaceId ?? ''}|${viewerScopeCacheKey(this.ctx.viewerScope)}`;
		if (connection.credentialScope === 'per_user' && connection.requesterUserId) {
			scopeKey = `${scopeKey}|u:${connection.requesterUserId}`;
		}

		const rateLimiter = getRateLimiter(provider.config.id, {
			requestsPerMinute: provider.config.rateLimit.requestsPerMinute,
			requestsPerSecond: provider.config.rateLimit.requestsPerSecond,
			burstLimit: provider.config.rateLimit.burstLimit,
			tracking: provider.config.rateLimit.quotaTracking,
		});

		const rateLimitKey = rateLimiter.getKey(
			provider.config.id,
			connection.id,
			connection.scope === 'workspace' ? connection.ownerKey : this.ctx.artifactId
		);

		const rateLimitResult = rateLimiter.checkAndConsume(rateLimitKey);
		if (!rateLimitResult.allowed) {
			return this.rateLimitedResponse(rateLimitResult, startTime, request.provider, request.endpoint, mode);
		}

		const shouldCache = request.options?.cache !== false && endpoint.method === 'GET';
		const forceRefresh = request.options?.forceRefresh === true;

		if (shouldCache && !forceRefresh) {
			const cacheKey = await PlatformCache.generateCacheKey(
				request.provider,
				request.endpoint,
				request.params as Record<string, unknown>,
				scopeKey
			);

			const cached = await this.cache.get<T>(cacheKey);
			if (cached) {
				return {
					success: true,
					data: cached.data,
					meta: {
						provider: request.provider,
						endpoint: request.endpoint,
						executionMode: mode,
						cached: true,
						cachedAt: new Date(cached.createdAt).toISOString(),
						executionTimeMs: Date.now() - startTime,
					},
					rateLimit: {
						remaining: rateLimitResult.remaining,
						limit: rateLimitResult.limit,
						resetAt: rateLimitResult.resetAt,
					},
				};
			}
		}

		let credentials: DecryptedCredentials;
		try {
			credentials = await getDecryptedCredentials(
				connection.encryptedCredentials,
				connection.iv,
				this.ctx.env.CREDENTIALS_KEY!
			);

			if (credentials.expires_at && credentials.expires_at < Date.now() + 60000) {
				if (credentials.refresh_token && provider.config.auth.refreshable) {
					const refreshed = await provider.refreshToken(
						{
							artifactId: this.ctx.artifactId,
							connectionId: connection.id,
							callbackUrl: '',
							state: '',
							params: connection.config as Record<string, string>,
							env: this.ctx.env,
						},
						credentials.refresh_token
					);

					credentials.access_token = refreshed.accessToken;
					credentials.refresh_token = refreshed.refreshToken || credentials.refresh_token;
					credentials.expires_at = refreshed.expiresAt;

					await saveCredentials(
						this.ctx.env,
						{
							scope: connection.scope,
							ownerKey: connection.ownerKey,
							connectionId: connection.id,
							credentialScope: connection.credentialScope,
							requesterUserId: connection.requesterUserId,
						},
						credentials,
						this.ctx.env.CREDENTIALS_KEY!
					);
				}
			}
		} catch {
			return this.errorResponse(PLATFORM_ERRORS.INVALID_CREDENTIALS, startTime);
		}

		try {
			const response = await provider.executeRequest<T>(
				{
					artifactId: this.ctx.artifactId,
					connectionId: connection.id,
					connectionConfig: connection,
					credentials,
					env: this.ctx.env,
					requestOrigin: this.ctx.requestOrigin,
				},
				endpoint,
				request.params || {}
			);

			if (!response.success) {
				return {
					success: false,
					error: {
						code: response.error?.code || PLATFORM_ERRORS.PROVIDER_ERROR.code,
						message: response.error?.message || PLATFORM_ERRORS.PROVIDER_ERROR.message,
						provider: request.provider,
						httpStatus: response.status || 502,
						retryable: response.status === 429 || (response.status ?? 0) >= 500,
					},
					meta: {
						provider: request.provider,
						endpoint: request.endpoint,
						executionMode: mode,
						cached: false,
						executionTimeMs: Date.now() - startTime,
					},
					rateLimit: response.rateLimit || {
						remaining: rateLimitResult.remaining,
						limit: rateLimitResult.limit,
						resetAt: rateLimitResult.resetAt,
					},
				};
			}

			if (shouldCache && response.data !== undefined) {
				const cacheKey = await PlatformCache.generateCacheKey(
					request.provider,
					request.endpoint,
					request.params as Record<string, unknown>,
					scopeKey
				);

				const ttlMs = request.options?.cacheTtl
					? request.options.cacheTtl * 1000
					: endpoint.cache?.ttlSeconds
						? endpoint.cache.ttlSeconds * 1000
						: provider.config.cache.defaultTtlSeconds * 1000;

				await this.cache.set(cacheKey, response.data, {
					ttlMs,
					provider: request.provider,
					endpoint: request.endpoint,
					persist: provider.config.cache.persistable,
					userRefreshable: provider.config.cache.userRefreshable,
				});
			}

			return {
				success: true,
				data: response.data,
				meta: {
					provider: request.provider,
					endpoint: request.endpoint,
					executionMode: mode,
					cached: false,
					executionTimeMs: Date.now() - startTime,
				},
				pagination: response.pagination,
				rateLimit: response.rateLimit || {
					remaining: rateLimitResult.remaining,
					limit: rateLimitResult.limit,
					resetAt: rateLimitResult.resetAt,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: {
					code: PLATFORM_ERRORS.PROVIDER_ERROR.code,
					message: error instanceof Error ? error.message : 'Unknown error',
					provider: request.provider,
					httpStatus: 502,
					retryable: true,
				},
				meta: {
					provider: request.provider,
					endpoint: request.endpoint,
					executionMode: mode,
					cached: false,
					executionTimeMs: Date.now() - startTime,
				},
			};
		}
	}

	async prepareForDirectMode(
		providerId: string,
		connectionId: string,
		endpointId: string
	): Promise<{
		mode: ExecutionMode;
		credentials?: {
			accessToken: string;
			expiresAt: number;
			authHeader: string;
			headerName: string;
		};
		providerConfig: {
			baseUrl: string;
			version?: string;
			defaultHeaders?: Record<string, string>;
		};
		endpoint: {
			id: string;
			method: string;
			path: string;
		};
	}> {
		// Direct mode hands credentials to the browser to call the provider itself,
		// which the server cannot filter. Forbidden under a row-level access policy.
		if (this.ctx.viewerScope) {
			throw new Error(PLATFORM_ERRORS.SCOPE_REQUIRED.message);
		}

		const provider = getProvider(providerId);
		if (!provider) {
			throw new Error(PLATFORM_ERRORS.PROVIDER_NOT_FOUND.message);
		}

		const endpoint = provider.getEndpoint(endpointId);
		if (!endpoint) {
			throw new Error(PLATFORM_ERRORS.ENDPOINT_NOT_FOUND.message);
		}

		const connection = await loadConnection(
			this.ctx.env,
			this.ctx.artifactId,
			connectionId,
			this.ctx.requesterUserId
		);

		const mode = resolveExecutionMode({
			provider: provider.config,
			endpoint,
			requestOrigin: this.ctx.requestOrigin,
			connectionConfig: connection,
		});

		const result = await prepareCredentialsForRequest(
			this.ctx.env,
			this.ctx.artifactId,
			connectionId,
			provider,
			mode,
			this.ctx.requesterUserId
		);

		return {
			mode: result.mode,
			credentials: result.direct
				? {
						accessToken: result.direct.accessToken,
						expiresAt: result.direct.expiresAt,
						authHeader: result.direct.authHeader,
						headerName: result.direct.headerName,
					}
				: undefined,
			providerConfig: {
				baseUrl: provider.config.api.baseUrl,
				version: provider.config.api.version,
				defaultHeaders: provider.config.api.defaultHeaders,
			},
			endpoint: {
				id: endpoint.id,
				method: endpoint.method,
				path: endpoint.path,
			},
		};
	}

	async refreshCache(providerId?: string, endpointId?: string): Promise<{ invalidated: number }> {
		const count = await this.cache.userRefresh(providerId || '', endpointId);
		return { invalidated: count };
	}

	async getCacheStatus(): Promise<{
		memoryEntries: number;
		providers: Record<string, { entries: number }>;
	}> {
		return this.cache.getStatus();
	}

	recordDirectUsage(providerId: string, connectionId: string): void {
		const provider = getProvider(providerId);
		if (!provider) return;

		const rateLimiter = getRateLimiter(providerId, {
			requestsPerMinute: provider.config.rateLimit.requestsPerMinute,
			requestsPerSecond: provider.config.rateLimit.requestsPerSecond,
			burstLimit: provider.config.rateLimit.burstLimit,
			tracking: provider.config.rateLimit.quotaTracking,
		});

		const key = rateLimiter.getKey(providerId, connectionId, this.ctx.artifactId);
		rateLimiter.recordDirectUsage(key);
	}

	private errorResponse<T>(
		error: (typeof PLATFORM_ERRORS)[keyof typeof PLATFORM_ERRORS],
		startTime: number
	): PlatformResponse<T> {
		return {
			success: false,
			error: {
				code: error.code,
				message: error.message,
				httpStatus: error.httpStatus,
				retryable: false,
			},
			meta: {
				provider: '',
				endpoint: '',
				executionMode: 'proxy',
				cached: false,
				executionTimeMs: Date.now() - startTime,
			},
		};
	}

	private rateLimitedResponse<T>(
		result: RateLimitResult,
		startTime: number,
		provider: string,
		endpoint: string,
		mode: ExecutionMode
	): PlatformResponse<T> {
		return {
			success: false,
			error: {
				code: PLATFORM_ERRORS.RATE_LIMITED.code,
				message: PLATFORM_ERRORS.RATE_LIMITED.message,
				httpStatus: 429,
				retryable: true,
				retryAfterMs: result.retryAfterMs,
			},
			meta: {
				provider,
				endpoint,
				executionMode: mode,
				cached: false,
				executionTimeMs: Date.now() - startTime,
			},
			rateLimit: {
				remaining: 0,
				limit: result.limit,
				resetAt: result.resetAt,
			},
		};
	}
}
