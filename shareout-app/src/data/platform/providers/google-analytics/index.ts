import { BaseProvider, type ProviderResponse, type VerifyResult } from '../base-provider';
import type { Env } from '../../types';
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
import { GOOGLE_ANALYTICS_CONFIG, GA_API_BASE } from './config';
import { registerProvider } from '../../registry';
import { getServiceAccountToken, type ServiceAccountKey } from '../bigquery/service-account';
import { createLogger, logError } from '../../../../logging';
import {
	userFacingAuthTokenError,
	userFacingProviderUpstreamError,
	userFacingVerifyUpstreamError,
} from '../../errors';

const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

function extractPropertyId(input: string): string {
	if (input.startsWith('properties/')) {
		return input;
	}
	return `properties/${input.replace(/\D/g, '')}`;
}

class GoogleAnalyticsProvider extends BaseProvider {
	readonly config = GOOGLE_ANALYTICS_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>([
		[
			'reports.run',
			{
				id: 'reports.run',
				method: 'POST',
				path: '/{propertyId}:runReport',
				description: 'Run a report with dimensions and metrics',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'reports.batchRun',
			{
				id: 'reports.batchRun',
				method: 'POST',
				path: '/{propertyId}:batchRunReports',
				description: 'Run multiple reports in a single request',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'reports.realtime',
			{
				id: 'reports.realtime',
				method: 'POST',
				path: '/{propertyId}:runRealtimeReport',
				description: 'Run a realtime report',
				cache: { ttlSeconds: 30 },
			},
		],
		[
			'metadata.get',
			{
				id: 'metadata.get',
				method: 'GET',
				path: '/{propertyId}/metadata',
				description: 'Get available dimensions and metrics for a property',
				cache: { ttlSeconds: 3600 },
			},
		],
		[
			'reports.pivot',
			{
				id: 'reports.pivot',
				method: 'POST',
				path: '/{propertyId}:runPivotReport',
				description: 'Run a pivot report',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'reports.funnel',
			{
				id: 'reports.funnel',
				method: 'POST',
				path: '/{propertyId}:runFunnelReport',
				description: 'Run a funnel report',
				cache: { ttlSeconds: 300 },
			},
		],
	]);

	// BYO service-account model: connections are created by pasting an SA key, not
	// via our OAuth app. The interactive OAuth methods are intentionally disabled.
	async getAuthUrl(_ctx: AuthContext): Promise<string> {
		throw new Error('Google Analytics connects with a service-account key, not OAuth');
	}

	async handleCallback(_ctx: AuthContext, _code: string): Promise<TokenResult> {
		throw new Error('Google Analytics connects with a service-account key, not OAuth');
	}

	async refreshToken(_ctx: AuthContext, _refreshToken: string): Promise<TokenResult> {
		throw new Error('Google Analytics service-account tokens are minted per request, not refreshed');
	}

	async prepareDirectCredentials(
		_ctx: AuthContext,
		_credentials: DecryptedCredentials
	): Promise<DirectCredentials> {
		throw new Error('Google Analytics runs in proxy mode only (server-side service-account token)');
	}

	// BYO model: connections store a service-account key and mint a token per query.
	// (Legacy OAuth connections, if any, still use the stored access token.)
	private async resolveAccessToken(credentials: DecryptedCredentials): Promise<string> {
		const sa = credentials.extra?.service_account as ServiceAccountKey | undefined;
		if (sa) return getServiceAccountToken(sa, GA_SCOPE);
		if (credentials.access_token) return credentials.access_token;
		throw new Error('No service-account credentials available for this connection');
	}

	async verifyConnection(
		env: Env,
		config: Record<string, unknown>,
		credentials: DecryptedCredentials
	): Promise<VerifyResult> {
		let token: string;
		try {
			token = await this.resolveAccessToken(credentials);
		} catch (err) {
			logError(
				createLogger(env, { scope: 'platform', provider: 'google-analytics', event: 'verify.auth.failed' }),
				'GA verify: token mint failed',
				err,
			);
			return { ok: false, message: userFacingAuthTokenError(err) };
		}
		const propertyId = extractPropertyId((config.propertyId as string) || '');
		if (!propertyId || propertyId === 'properties/') {
			// No property to probe, but minting the token proves the key is valid.
			return { ok: true, message: 'Service account key is valid' };
		}
		const res = await fetch(`${GA_API_BASE}/${propertyId}/metadata`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (res.ok) return { ok: true, message: 'Connected to property ' + propertyId };
		logError(
			createLogger(env, {
				scope: 'platform',
				provider: 'google-analytics',
				event: 'verify.upstream.failed',
				http_status: res.status,
			}),
			'GA verify: property metadata probe failed',
			new Error(`HTTP ${res.status}`),
		);
		return { ok: false, message: userFacingVerifyUpstreamError(res.status) };
	}

	async executeRequest<T = unknown>(
		ctx: ExecutionContext,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): Promise<ProviderResponse<T>> {
		const propertyId = extractPropertyId(
			(params.pathParams?.propertyId as string) ||
				(ctx.connectionConfig.config.propertyId as string) ||
				''
		);

		if (!propertyId || propertyId === 'properties/') {
			return {
				success: false,
				error: {
					code: 'MISSING_PROPERTY_ID',
					message: 'propertyId is required (e.g., "123456789" or "properties/123456789")',
				},
			};
		}

		const pathParams = { ...params.pathParams, propertyId };
		let url = this.buildUrl(GA_API_BASE, endpoint, { ...params, pathParams });

		const queryParams = new URLSearchParams();
		if (params.queryParams) {
			for (const [key, value] of Object.entries(params.queryParams)) {
				if (key !== 'propertyId' && value !== undefined) {
					queryParams.set(key, String(value));
				}
			}
		}

		if (queryParams.toString()) {
			url = `${url}?${queryParams}`;
		}

		let accessToken: string;
		try {
			accessToken = await this.resolveAccessToken(ctx.credentials);
		} catch (err) {
			logError(
				createLogger(ctx.env, { scope: 'platform', provider: 'google-analytics', event: 'execute.auth.failed' }),
				'GA execute: token mint failed',
				err,
			);
			return {
				success: false,
				error: { code: 'AUTH_TOKEN_ERROR', message: userFacingAuthTokenError(err) },
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
					provider: 'google-analytics',
					event: 'execute.upstream.failed',
					http_status: response.status,
				}),
				'GA execute: upstream request failed',
				new Error(`HTTP ${response.status}`),
			);
			return {
				success: false,
				status: response.status,
				error: {
					code: `GA_ERROR_${response.status}`,
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

	extractNextPage(response: ProviderResponse): PageInfo | null {
		const data = response.data as { rowCount?: number; rows?: unknown[] } | undefined;
		if (!data) return null;

		if (data.rowCount && data.rows) {
			const hasMore = data.rows.length < data.rowCount;
			return hasMore ? { hasMore, nextOffset: data.rows.length } : null;
		}

		return null;
	}

	extractRateLimitInfo(response: Response): RateLimitInfo | null {
		const remaining = response.headers.get('X-RateLimit-Remaining');
		const limit = response.headers.get('X-RateLimit-Limit');

		if (remaining && limit) {
			return {
				remaining: parseInt(remaining, 10),
				limit: parseInt(limit, 10),
			};
		}

		return null;
	}
}

const googleAnalyticsProvider = new GoogleAnalyticsProvider();
registerProvider(googleAnalyticsProvider);

export { googleAnalyticsProvider };
export { GOOGLE_ANALYTICS_CONFIG } from './config';
