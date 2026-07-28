import { BaseProvider, type ProviderResponse } from '../base-provider';
import type {
	ProviderEndpoint,
	AuthContext,
	TokenResult,
	ExecutionContext,
	RequestParams,
	DirectCredentials,
	DecryptedCredentials,
	PageInfo,
	RateLimitInfo,
} from '../../types';
import { BIGQUERY_CONFIG, BIGQUERY_API_BASE } from './config';
import { registerProvider } from '../../registry';
import { getServiceAccountToken, type ServiceAccountKey } from './service-account';
import { getAuthorizedUserToken, type AuthorizedUserKey } from './authorized-user';
import { createLogger, logError } from '../../../../logging';
import { userFacingAuthTokenError, userFacingProviderUpstreamError } from '../../errors';

class BigQueryProvider extends BaseProvider {
	readonly config = BIGQUERY_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>([
		[
			'jobs.query',
			{
				id: 'jobs.query',
				method: 'POST',
				path: '/projects/{projectId}/queries',
				description: 'Run a SQL query and return rows synchronously',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'jobs.getQueryResults',
			{
				id: 'jobs.getQueryResults',
				method: 'GET',
				path: '/projects/{projectId}/queries/{jobId}',
				description: 'Fetch a page of results for an already-run query job (follow jobs.query\'s pageToken)',
				cache: { ttlSeconds: 60 },
			},
		],
		[
			'datasets.list',
			{
				id: 'datasets.list',
				method: 'GET',
				path: '/projects/{projectId}/datasets',
				description: 'List datasets in a project',
				cache: { ttlSeconds: 3600 },
			},
		],
		[
			'tables.list',
			{
				id: 'tables.list',
				method: 'GET',
				path: '/projects/{projectId}/datasets/{datasetId}/tables',
				description: 'List tables in a dataset',
				cache: { ttlSeconds: 3600 },
			},
		],
	]);

	async getAuthUrl(ctx: AuthContext): Promise<string> {
		const config = this.config.auth.oauth!;
		const params = new URLSearchParams({
			client_id: ctx.env.GOOGLE_CLIENT_ID || "",
			redirect_uri: ctx.callbackUrl,
			response_type: 'code',
			scope: config.scopes.join(' '),
			access_type: 'offline',
			prompt: 'consent',
			state: ctx.state,
		});
		return `${config.authorizationUrl}?${params}`;
	}

	async handleCallback(ctx: AuthContext, code: string): Promise<TokenResult> {
		const config = this.config.auth.oauth!;

		const response = await fetch(config.tokenUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: ctx.env.GOOGLE_CLIENT_ID || "",
				client_secret: ctx.env.GOOGLE_CLIENT_SECRET || "",
				code,
				grant_type: 'authorization_code',
				redirect_uri: ctx.callbackUrl,
			}),
		});

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'bigquery',
					event: 'oauth.token.failed',
					http_status: response.status,
				}),
				'BigQuery OAuth token exchange failed',
				new Error(`HTTP ${response.status}`),
			);
			throw new Error(userFacingAuthTokenError(new Error(`HTTP ${response.status}`)));
		}

		const data = (await response.json()) as {
			access_token: string;
			refresh_token?: string;
			expires_in: number;
			scope: string;
		};

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + data.expires_in * 1000,
			scope: data.scope,
		};
	}

	async refreshToken(ctx: AuthContext, refreshToken: string): Promise<TokenResult> {
		const config = this.config.auth.oauth!;

		const response = await fetch(config.tokenUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: ctx.env.GOOGLE_CLIENT_ID || "",
				client_secret: ctx.env.GOOGLE_CLIENT_SECRET || "",
				refresh_token: refreshToken,
				grant_type: 'refresh_token',
			}),
		});

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'bigquery',
					event: 'oauth.refresh.failed',
					http_status: response.status,
				}),
				'BigQuery OAuth token refresh failed',
				new Error(`HTTP ${response.status}`),
			);
			throw new Error(userFacingAuthTokenError(new Error(`HTTP ${response.status}`)));
		}

		const data = (await response.json()) as {
			access_token: string;
			expires_in: number;
		};

		return {
			accessToken: data.access_token,
			refreshToken,
			expiresAt: Date.now() + data.expires_in * 1000,
		};
	}

	async prepareDirectCredentials(
		_ctx: AuthContext,
		credentials: DecryptedCredentials
	): Promise<DirectCredentials> {
		return {
			accessToken: credentials.access_token,
			expiresAt: credentials.expires_at || Date.now() + 3600000,
			authHeader: `Bearer ${credentials.access_token}`,
			headerName: 'Authorization',
			allowedHosts: ['bigquery.googleapis.com'],
		};
	}

	async executeRequest<T = unknown>(
		ctx: ExecutionContext,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): Promise<ProviderResponse<T>> {
		const projectId =
			(params.pathParams?.projectId as string) ||
			(ctx.connectionConfig.config.projectId as string) ||
			'';

		if (!projectId) {
			return {
				success: false,
				error: {
					code: 'MISSING_PROJECT_ID',
					message: 'projectId is required (set it on the connection config or pass it as a path param)',
				},
			};
		}

		const pathParams = { ...params.pathParams, projectId };
		// Build by concatenation: endpoint paths are absolute ("/projects/..."), and
		// `new URL(path, base)` would discard the "/bigquery/v2" base path prefix.
		let resolvedPath = endpoint.path;
		for (const [key, value] of Object.entries(pathParams)) {
			resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(String(value)));
		}
		let url = `${BIGQUERY_API_BASE}${resolvedPath}`;
		if (params.queryParams) {
			const qs = new URLSearchParams();
			for (const [key, value] of Object.entries(params.queryParams)) {
				if (value !== undefined && value !== null) qs.set(key, String(value));
			}
			const q = qs.toString();
			if (q) url += `?${q}`;
		}

		let accessToken: string;
		try {
			accessToken = await this.resolveAccessToken(ctx.credentials);
		} catch (err) {
			logError(
				createLogger(ctx.env, { scope: 'platform', provider: 'bigquery', event: 'execute.auth.failed' }),
				'BigQuery execute: token mint failed',
				err,
			);
			return {
				success: false,
				error: {
					code: 'AUTH_TOKEN_ERROR',
					message: userFacingAuthTokenError(err),
				},
			};
		}

		const response = await fetch(url, {
			method: endpoint.method,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: params.body ? JSON.stringify(params.body) : undefined,
		});

		const rateLimit = this.extractRateLimitInfo(response);

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'bigquery',
					event: 'execute.upstream.failed',
					http_status: response.status,
				}),
				'BigQuery execute: upstream request failed',
				new Error(`HTTP ${response.status}`),
			);
			return {
				success: false,
				status: response.status,
				error: {
					code: `BIGQUERY_ERROR_${response.status}`,
					message: userFacingProviderUpstreamError(response.status),
				},
				rateLimit: rateLimit || undefined,
			};
		}

		const data = (await response.json()) as T;
		const pagination = this.extractNextPage({ data } as ProviderResponse);

		return {
			success: true,
			data,
			status: response.status,
			rateLimit: rateLimit || undefined,
			pagination: pagination || undefined,
		};
	}

	// Service-account connections mint a fresh token from the stored key; OAuth
	// connections use the (engine-refreshed) access token directly.
	private async resolveAccessToken(credentials: DecryptedCredentials): Promise<string> {
		const sa = credentials.extra?.service_account as ServiceAccountKey | undefined;
		if (sa) {
			return getServiceAccountToken(sa, this.config.auth.oauth!.scopes.join(' '));
		}
		const au = credentials.extra?.authorized_user as AuthorizedUserKey | undefined;
		if (au) {
			return getAuthorizedUserToken(au);
		}
		if (!credentials.access_token) {
			throw new Error('No access token or service account credentials available');
		}
		return credentials.access_token;
	}

	extractNextPage(response: ProviderResponse): PageInfo | null {
		const data = response.data as { pageToken?: string; jobComplete?: boolean } | undefined;
		if (!data) return null;
		if (data.pageToken) {
			return { hasMore: true, cursor: data.pageToken };
		}
		return null;
	}

	extractRateLimitInfo(_response: Response): RateLimitInfo | null {
		return null;
	}
}

const bigQueryProvider = new BigQueryProvider();
registerProvider(bigQueryProvider);

export { bigQueryProvider };
export { BIGQUERY_CONFIG } from './config';
