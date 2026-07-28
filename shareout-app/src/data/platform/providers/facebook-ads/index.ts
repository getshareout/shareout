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
import { FACEBOOK_ADS_CONFIG, FACEBOOK_ADS_API_BASE } from './config';
import { registerProvider } from '../../registry';
import { createLogger, logError } from '../../../../logging';
import { userFacingProviderUpstreamError, userFacingVerifyUpstreamError } from '../../errors';

// Normalize an ad account id to the "act_<digits>" form the Graph API expects.
function normalizeAccountId(input: string): string {
	const raw = String(input || '').trim();
	if (!raw) return '';
	if (raw.startsWith('act_')) return raw;
	return `act_${raw.replace(/\D/g, '')}`;
}

class FacebookAdsProvider extends BaseProvider {
	readonly config = FACEBOOK_ADS_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>([
		[
			'insights',
			{
				id: 'insights',
				method: 'GET',
				path: '/{accountId}/insights',
				description: 'Ad account insights (spend, impressions, clicks, ROAS) by date/level',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'campaigns',
			{
				id: 'campaigns',
				method: 'GET',
				path: '/{accountId}/campaigns',
				description: 'List campaigns in the ad account',
				cache: { ttlSeconds: 600 },
			},
		],
		[
			'adsets',
			{
				id: 'adsets',
				method: 'GET',
				path: '/{accountId}/adsets',
				description: 'List ad sets in the ad account',
				cache: { ttlSeconds: 600 },
			},
		],
		[
			'ads',
			{
				id: 'ads',
				method: 'GET',
				path: '/{accountId}/ads',
				description: 'List ads in the ad account',
				cache: { ttlSeconds: 600 },
			},
		],
	]);

	// Token-shim connector: connected by pasting a token, not via our OAuth flow.
	async getAuthUrl(_ctx: AuthContext): Promise<string> {
		throw new Error('Facebook Ads connects with a pasted access token, not OAuth');
	}

	async handleCallback(_ctx: AuthContext, _code: string): Promise<TokenResult> {
		throw new Error('Facebook Ads connects with a pasted access token, not OAuth');
	}

	async refreshToken(_ctx: AuthContext, _refreshToken: string): Promise<TokenResult> {
		throw new Error('Facebook Ads long-lived tokens are not refreshable');
	}

	async prepareDirectCredentials(
		_ctx: AuthContext,
		_credentials: DecryptedCredentials
	): Promise<DirectCredentials> {
		throw new Error('Facebook Ads runs in proxy mode only');
	}

	async verifyConnection(
		env: Env,
		config: Record<string, unknown>,
		credentials: DecryptedCredentials
	): Promise<VerifyResult> {
		const accountId = normalizeAccountId((config.account_id as string) || '');
		if (!accountId || accountId === 'act_') return { ok: false, message: 'Ad account ID is required' };
		if (!credentials.access_token) return { ok: false, message: 'Access token is required' };
		const res = await fetch(`${FACEBOOK_ADS_API_BASE}/${accountId}?fields=name,currency`, {
			headers: { Authorization: `Bearer ${credentials.access_token}` },
		});
		if (res.ok) {
			const d = (await res.json().catch(() => ({}))) as { name?: string };
			return { ok: true, message: d.name ? `Connected to ${d.name}` : 'Token valid' };
		}
		logError(
			createLogger(env, {
				scope: 'platform',
				provider: 'facebook-ads',
				event: 'verify.upstream.failed',
				http_status: res.status,
			}),
			'Facebook Ads verify: account probe failed',
			new Error(`HTTP ${res.status}`),
		);
		return { ok: false, message: userFacingVerifyUpstreamError(res.status) };
	}

	async executeRequest<T = unknown>(
		ctx: ExecutionContext,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): Promise<ProviderResponse<T>> {
		const accountId = normalizeAccountId(
			(params.pathParams?.accountId as string) ||
				(ctx.connectionConfig.config.account_id as string) ||
				''
		);

		if (!accountId || accountId === 'act_') {
			return {
				success: false,
				error: {
					code: 'MISSING_ACCOUNT_ID',
					message: 'account_id is required (set it on the connection or pass it as a path param)',
				},
			};
		}

		const accessToken = ctx.credentials.access_token;
		if (!accessToken) {
			return {
				success: false,
				error: { code: 'MISSING_TOKEN', message: 'No access token stored for this connection' },
			};
		}

		let resolvedPath = endpoint.path.replace('{accountId}', encodeURIComponent(accountId));
		let url = `${FACEBOOK_ADS_API_BASE}${resolvedPath}`;
		if (params.queryParams) {
			const qs = new URLSearchParams();
			for (const [key, value] of Object.entries(params.queryParams)) {
				if (value !== undefined && value !== null) qs.set(key, String(value));
			}
			const q = qs.toString();
			if (q) url += `?${q}`;
		}

		const response = await fetch(url, {
			method: endpoint.method,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: params.body ? JSON.stringify(params.body) : undefined,
		});

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'facebook-ads',
					event: 'execute.upstream.failed',
					http_status: response.status,
				}),
				'Facebook Ads execute: upstream request failed',
				new Error(`HTTP ${response.status}`),
			);
			return {
				success: false,
				status: response.status,
				error: {
					code: `FACEBOOK_ADS_ERROR_${response.status}`,
					message: userFacingProviderUpstreamError(response.status),
				},
			};
		}

		const data = (await response.json()) as T;
		const pagination = this.extractNextPage({ data } as ProviderResponse);

		return {
			success: true,
			data,
			status: response.status,
			pagination: pagination || undefined,
		};
	}

	extractNextPage(response: ProviderResponse): PageInfo | null {
		const data = response.data as { paging?: { next?: string; cursors?: { after?: string } } } | undefined;
		if (!data?.paging) return null;
		if (data.paging.next && data.paging.cursors?.after) {
			return { hasMore: true, cursor: data.paging.cursors.after };
		}
		return null;
	}

	extractRateLimitInfo(_response: Response): RateLimitInfo | null {
		return null;
	}
}

const facebookAdsProvider = new FacebookAdsProvider();
registerProvider(facebookAdsProvider);

export { facebookAdsProvider };
export { FACEBOOK_ADS_CONFIG } from './config';
