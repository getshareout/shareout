import { BaseProvider, type ProviderResponse, type VerifyResult } from '../base-provider';
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
	Env,
} from '../../types';
import { GOOGLE_ADS_CONFIG, GOOGLE_ADS_API_BASE } from './config';
import { registerProvider } from '../../registry';
import { getAuthorizedUserToken, type AuthorizedUserKey } from '../bigquery/authorized-user';
import { createLogger, logError } from '../../../../logging';
import { userFacingAuthTokenError, userFacingProviderUpstreamError } from '../../errors';

// Customer ids are 10 digits; users often paste them dashed (123-456-7890).
function normalizeCustomerId(input: string): string {
	return String(input || '').replace(/\D/g, '');
}

class GoogleAdsProvider extends BaseProvider {
	readonly config = GOOGLE_ADS_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>([
		[
			'search',
			{
				id: 'search',
				method: 'POST',
				path: '/customers/{customerId}/googleAds:searchStream',
				description: 'Run a GAQL query against the Google Ads account',
				cache: { ttlSeconds: 300 },
			},
		],
	]);

	// Token-shim connector: connected by pasting credentials, not via our OAuth flow.
	async getAuthUrl(_ctx: AuthContext): Promise<string> {
		throw new Error('Google Ads connects with pasted credentials, not OAuth');
	}

	async handleCallback(_ctx: AuthContext, _code: string): Promise<TokenResult> {
		throw new Error('Google Ads connects with pasted credentials, not OAuth');
	}

	async refreshToken(_ctx: AuthContext, _refreshToken: string): Promise<TokenResult> {
		throw new Error('Google Ads refreshes tokens internally from the stored refresh token');
	}

	async prepareDirectCredentials(
		_ctx: AuthContext,
		_credentials: DecryptedCredentials
	): Promise<DirectCredentials> {
		throw new Error('Google Ads runs in proxy mode only');
	}

	async verifyConnection(
		env: Env,
		config: Record<string, unknown>,
		credentials: DecryptedCredentials
	): Promise<VerifyResult> {
		const au = credentials.extra?.authorized_user as AuthorizedUserKey | undefined;
		const developerToken = credentials.extra?.developer_token as string | undefined;
		if (!au) return { ok: false, message: 'OAuth credentials are required' };
		if (!developerToken) return { ok: false, message: 'Developer token is required' };
		if (!config.customer_id) return { ok: false, message: 'Customer ID is required' };
		try {
			await getAuthorizedUserToken(au);
		} catch (err) {
			logError(
				createLogger(env, { scope: 'platform', provider: 'google-ads', event: 'verify.auth.failed' }),
				'Google Ads verify: token refresh failed',
				err,
			);
			return { ok: false, message: userFacingAuthTokenError(err) };
		}
		return { ok: true, message: 'OAuth credentials are valid' };
	}

	async executeRequest<T = unknown>(
		ctx: ExecutionContext,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): Promise<ProviderResponse<T>> {
		const customerId = normalizeCustomerId(
			(params.pathParams?.customerId as string) ||
				(ctx.connectionConfig.config.customer_id as string) ||
				''
		);

		if (!customerId) {
			return {
				success: false,
				error: {
					code: 'MISSING_CUSTOMER_ID',
					message: 'customer_id is required (set it on the connection or pass it as a path param)',
				},
			};
		}

		const au = ctx.credentials.extra?.authorized_user as AuthorizedUserKey | undefined;
		const developerToken = ctx.credentials.extra?.developer_token as string | undefined;
		if (!au) {
			return {
				success: false,
				error: { code: 'MISSING_CREDENTIALS', message: 'No authorized-user credentials stored for this connection' },
			};
		}
		if (!developerToken) {
			return {
				success: false,
				error: { code: 'MISSING_DEVELOPER_TOKEN', message: 'No Google Ads developer token stored for this connection' },
			};
		}

		let accessToken: string;
		try {
			accessToken = await getAuthorizedUserToken(au);
		} catch (err) {
			logError(
				createLogger(ctx.env, { scope: 'platform', provider: 'google-ads', event: 'execute.auth.failed' }),
				'Google Ads execute: token refresh failed',
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

		const resolvedPath = endpoint.path.replace('{customerId}', encodeURIComponent(customerId));
		const url = `${GOOGLE_ADS_API_BASE}${resolvedPath}`;

		const headers: Record<string, string> = {
			Authorization: `Bearer ${accessToken}`,
			'developer-token': developerToken,
			'Content-Type': 'application/json',
		};
		const loginCustomerId = normalizeCustomerId(
			(ctx.connectionConfig.config.login_customer_id as string) || ''
		);
		if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

		const response = await fetch(url, {
			method: endpoint.method,
			headers,
			body: params.body ? JSON.stringify(params.body) : undefined,
		});

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'google-ads',
					event: 'execute.upstream.failed',
					http_status: response.status,
				}),
				'Google Ads execute: upstream request failed',
				new Error(`HTTP ${response.status}`),
			);
			return {
				success: false,
				status: response.status,
				error: {
					code: `GOOGLE_ADS_ERROR_${response.status}`,
					message: userFacingProviderUpstreamError(response.status),
				},
			};
		}

		const data = (await response.json()) as T;
		return { success: true, data, status: response.status };
	}

	extractNextPage(_response: ProviderResponse): PageInfo | null {
		return null;
	}

	extractRateLimitInfo(_response: Response): RateLimitInfo | null {
		return null;
	}
}

const googleAdsProvider = new GoogleAdsProvider();
registerProvider(googleAdsProvider);

export { googleAdsProvider };
export { GOOGLE_ADS_CONFIG } from './config';
