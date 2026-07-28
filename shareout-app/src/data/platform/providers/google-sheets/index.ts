import {
	BaseProvider,
	type ProviderResponse,
} from '../base-provider';
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
import { GOOGLE_SHEETS_CONFIG, SHEETS_API_BASE } from './config';
import { registerProvider } from '../../registry';
import { createLogger, logError } from '../../../../logging';
import { userFacingAuthTokenError, userFacingProviderUpstreamError } from '../../errors';

function extractSpreadsheetId(urlOrId: string): string {
	if (urlOrId.includes('/')) {
		const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
		return match ? match[1] : urlOrId;
	}
	return urlOrId;
}

class GoogleSheetsProvider extends BaseProvider {
	readonly config = GOOGLE_SHEETS_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>([
		[
			'values.get',
			{
				id: 'values.get',
				method: 'GET',
				path: '/{spreadsheetId}/values/{range}',
				description: 'Get values from a range',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'values.update',
			{
				id: 'values.update',
				method: 'PUT',
				path: '/{spreadsheetId}/values/{range}',
				description: 'Update values in a range',
				execution: { requiresProxy: false },
			},
		],
		[
			'values.append',
			{
				id: 'values.append',
				method: 'POST',
				path: '/{spreadsheetId}/values/{range}:append',
				description: 'Append values to a sheet',
				execution: { requiresProxy: false },
			},
		],
		[
			'spreadsheets.get',
			{
				id: 'spreadsheets.get',
				method: 'GET',
				path: '/{spreadsheetId}',
				description: 'Get spreadsheet metadata',
				cache: { ttlSeconds: 600 },
			},
		],
		[
			'values.batchGet',
			{
				id: 'values.batchGet',
				method: 'GET',
				path: '/{spreadsheetId}/values:batchGet',
				description: 'Get values from multiple ranges',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'values.batchUpdate',
			{
				id: 'values.batchUpdate',
				method: 'POST',
				path: '/{spreadsheetId}/values:batchUpdate',
				description: 'Update values in multiple ranges',
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
					provider: 'google-sheets',
					event: 'oauth.token.failed',
					http_status: response.status,
				}),
				'Google Sheets OAuth token exchange failed',
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
					provider: 'google-sheets',
					event: 'oauth.refresh.failed',
					http_status: response.status,
				}),
				'Google Sheets OAuth token refresh failed',
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
			allowedHosts: ['sheets.googleapis.com'],
		};
	}

	async executeRequest<T = unknown>(
		ctx: ExecutionContext,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): Promise<ProviderResponse<T>> {
		const spreadsheetId = extractSpreadsheetId(
			(params.pathParams?.spreadsheetId as string) ||
				(params.queryParams?.spreadsheetUrl as string) ||
				''
		);

		if (!spreadsheetId) {
			return {
				success: false,
				error: {
					code: 'MISSING_SPREADSHEET_ID',
					message: 'spreadsheetId or spreadsheetUrl is required',
				},
			};
		}

		const pathParams = { ...params.pathParams, spreadsheetId };
		const url = this.buildUrl(SHEETS_API_BASE, endpoint, { ...params, pathParams });

		const queryParams = new URLSearchParams();
		if (params.queryParams) {
			for (const [key, value] of Object.entries(params.queryParams)) {
				if (key !== 'spreadsheetUrl' && value !== undefined) {
					queryParams.set(key, String(value));
				}
			}
		}

		if (endpoint.id === 'values.update') {
			queryParams.set('valueInputOption', 'USER_ENTERED');
		}
		if (endpoint.id === 'values.append') {
			queryParams.set('valueInputOption', 'USER_ENTERED');
			queryParams.set('insertDataOption', 'INSERT_ROWS');
		}

		const finalUrl = queryParams.toString() ? `${url}?${queryParams}` : url;

		const response = await fetch(finalUrl, {
			method: endpoint.method,
			headers: {
				Authorization: `Bearer ${ctx.credentials.access_token}`,
				'Content-Type': 'application/json',
			},
			body: params.body ? JSON.stringify(params.body) : undefined,
		});

		const rateLimit = this.extractRateLimitInfo(response);

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'google-sheets',
					event: 'execute.upstream.failed',
					http_status: response.status,
				}),
				'Google Sheets execute: upstream request failed',
				new Error(`HTTP ${response.status}`),
			);
			return {
				success: false,
				status: response.status,
				error: {
					code: `SHEETS_ERROR_${response.status}`,
					message: userFacingProviderUpstreamError(response.status),
				},
				rateLimit: rateLimit || undefined,
			};
		}

		const data = (await response.json()) as T;

		return {
			success: true,
			data,
			status: response.status,
			rateLimit: rateLimit || undefined,
		};
	}

	extractNextPage(_response: ProviderResponse): PageInfo | null {
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

const googleSheetsProvider = new GoogleSheetsProvider();
registerProvider(googleSheetsProvider);

export { googleSheetsProvider };
export { GOOGLE_SHEETS_CONFIG } from './config';
