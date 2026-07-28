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
import { SNOWFLAKE_CONFIG } from './config';
import { registerProvider } from '../../registry';
import { getSnowflakeJwt, type SnowflakeKeyPair } from './jwt';
import { createLogger, logError } from '../../../../logging';
import { userFacingProviderUpstreamError, userFacingSnowflakeJwtError } from '../../errors';
import type { Env } from '../../types';

interface SnowflakeConnectionConfig {
	account?: string;
	host?: string;
	accountIdentifier?: string;
	user?: string;
	role?: string;
	warehouse?: string;
	database?: string;
	schema?: string;
	publicKeyFingerprint?: string;
}

interface SnowflakeStatementBody {
	statement?: string;
	sql?: string;
	timeout?: number;
	bindings?: Record<string, { type: string; value: unknown }>;
	parameters?: Record<string, string>;
}

const ASYNC_POLL_ATTEMPTS = 20;
const ASYNC_POLL_DELAY_MS = 2000;

// JWT account defaults to the host account with any region/cloud suffix dropped
// (locator accounts) — overridable via config.accountIdentifier for edge cases.
function deriveJwtAccount(cfg: SnowflakeConnectionConfig): string {
	if (cfg.accountIdentifier) return cfg.accountIdentifier.toUpperCase();
	return (cfg.account || '').split('.')[0].toUpperCase();
}

function resolveHost(cfg: SnowflakeConnectionConfig): string {
	if (cfg.host) return cfg.host.replace(/\/+$/, '');
	return `https://${cfg.account}.snowflakecomputing.com`;
}

class SnowflakeProvider extends BaseProvider {
	readonly config = SNOWFLAKE_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>([
		[
			'statements.execute',
			{
				id: 'statements.execute',
				method: 'POST',
				path: '/api/v2/statements',
				description: 'Run a SQL statement and return rows',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'statements.get',
			{
				id: 'statements.get',
				method: 'GET',
				path: '/api/v2/statements/{statementHandle}',
				description: 'Fetch the status/results of a submitted statement',
				cache: { ttlSeconds: 0 },
			},
		],
	]);

	// Key-pair auth has no browser OAuth flow.
	async getAuthUrl(): Promise<string> {
		throw new Error('Snowflake uses key-pair auth; create the connection with credentials instead of an auth URL');
	}

	async handleCallback(): Promise<TokenResult> {
		throw new Error('Snowflake does not use an OAuth callback');
	}

	async refreshToken(): Promise<TokenResult> {
		throw new Error('Snowflake key-pair credentials do not refresh; the JWT is minted per request');
	}

	async prepareDirectCredentials(): Promise<DirectCredentials> {
		throw new Error('Snowflake does not support direct (browser) execution mode');
	}

	async executeRequest<T = unknown>(
		ctx: ExecutionContext,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): Promise<ProviderResponse<T>> {
		const cfg = ctx.connectionConfig.config as SnowflakeConnectionConfig;
		const keyPair = this.resolveKeyPair(ctx.credentials, cfg);
		if (!keyPair.ok) return keyPair.response as ProviderResponse<T>;

		let jwt: string;
		try {
			jwt = await getSnowflakeJwt(keyPair.value);
		} catch (err) {
			logError(
				createLogger(ctx.env, { scope: 'platform', provider: 'snowflake', event: 'execute.jwt.failed' }),
				'Snowflake execute: JWT sign failed',
				err,
			);
			return {
				success: false,
				error: {
					code: 'SNOWFLAKE_JWT_ERROR',
					message: userFacingSnowflakeJwtError(err),
				},
			};
		}

		const host = resolveHost(cfg);
		const headers: Record<string, string> = {
			Authorization: `Bearer ${jwt}`,
			'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
			'Content-Type': 'application/json',
			Accept: 'application/json',
			// Snowflake's SQL API rejects requests without a User-Agent.
			'User-Agent': 'ShareOut-DataPlatform/1.0',
		};

		if (endpoint.id === 'statements.get') {
			const handle = params.pathParams?.statementHandle;
			if (!handle) {
				return this.errorResponse('MISSING_STATEMENT_HANDLE', 'statementHandle path param is required');
			}
			return this.fetchJson<T>(`${host}/api/v2/statements/${encodeURIComponent(String(handle))}`, {
				method: 'GET',
				headers,
			}, ctx.env);
		}

		// statements.execute
		const sql = this.extractStatement(params);
		if (!sql) {
			return this.errorResponse('MISSING_STATEMENT', 'A SQL statement is required (params.body.statement)');
		}

		const body = (params.body as SnowflakeStatementBody) || {};
		const requestBody: Record<string, unknown> = {
			statement: sql,
			timeout: body.timeout ?? 60,
			...(cfg.database ? { database: cfg.database } : {}),
			...(cfg.schema ? { schema: cfg.schema } : {}),
			...(cfg.warehouse ? { warehouse: cfg.warehouse } : {}),
			...(cfg.role ? { role: cfg.role } : {}),
			...(body.bindings ? { bindings: body.bindings } : {}),
			...(body.parameters ? { parameters: body.parameters } : {}),
		};

		const first = await this.fetchJson<T>(`${host}/api/v2/statements`, {
			method: 'POST',
			headers,
			body: JSON.stringify(requestBody),
		}, ctx.env);

		// 202 => async execution; poll the statement handle until it completes.
		if (first.status === 202) {
			const handle = (first.data as { statementHandle?: string } | undefined)?.statementHandle;
			if (!handle) return first;
			return this.pollStatement<T>(host, handle, headers, ctx.env);
		}

		return first;
	}

	private resolveKeyPair(
		credentials: DecryptedCredentials,
		cfg: SnowflakeConnectionConfig
	): { ok: true; value: SnowflakeKeyPair } | { ok: false; response: ProviderResponse } {
		const extra = credentials.extra || {};
		const privateKey = (extra.private_key as string) || (credentials.access_token as string);
		const user = cfg.user || (extra.user as string);
		const fingerprint = cfg.publicKeyFingerprint || (extra.public_key_fingerprint as string);
		const account = deriveJwtAccount(cfg) || (extra.account as string);

		const missing: string[] = [];
		if (!account) missing.push('account');
		if (!user) missing.push('user');
		if (!fingerprint) missing.push('publicKeyFingerprint');
		if (!privateKey) missing.push('private_key (credentials.extra.private_key)');

		if (missing.length > 0) {
			return {
				ok: false,
				response: this.errorResponse(
					'MISSING_SNOWFLAKE_CONFIG',
					`Missing required Snowflake settings: ${missing.join(', ')}`
				),
			};
		}

		return {
			ok: true,
			value: { account, user, publicKeyFingerprint: fingerprint, privateKey },
		};
	}

	private extractStatement(params: RequestParams): string | null {
		const body = params.body as SnowflakeStatementBody | string | undefined;
		if (typeof body === 'string') return body;
		if (body?.statement) return body.statement;
		if (body?.sql) return body.sql;
		const q = params.queryParams?.statement;
		return q ? String(q) : null;
	}

	private async pollStatement<T>(
		host: string,
		handle: string,
		headers: Record<string, string>,
		env: Env
	): Promise<ProviderResponse<T>> {
		const url = `${host}/api/v2/statements/${encodeURIComponent(handle)}`;
		for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, ASYNC_POLL_DELAY_MS));
			const res = await this.fetchJson<T>(url, { method: 'GET', headers }, env);
			if (res.status !== 202) return res;
		}
		return this.errorResponse('SNOWFLAKE_TIMEOUT', 'Statement did not complete within the polling window') as ProviderResponse<T>;
	}

	private async fetchJson<T>(url: string, init: RequestInit, env: Env): Promise<ProviderResponse<T>> {
		const response = await fetch(url, init);
		const status = response.status;

		if (!response.ok && status !== 202) {
			logError(
				createLogger(env, {
					scope: 'platform',
					provider: 'snowflake',
					event: 'execute.upstream.failed',
					http_status: status,
				}),
				'Snowflake execute: upstream request failed',
				new Error(`HTTP ${status}`),
			);
			return {
				success: false,
				status,
				error: {
					code: `SNOWFLAKE_ERROR_${status}`,
					message: userFacingProviderUpstreamError(status),
				},
			};
		}

		const data = (await response.json().catch(() => ({}))) as T;
		const pagination = this.extractNextPage({ data } as ProviderResponse);
		return {
			success: status !== 202,
			data,
			status,
			pagination: pagination || undefined,
		};
	}

	private errorResponse<T = unknown>(code: string, message: string): ProviderResponse<T> {
		return { success: false, error: { code, message } };
	}

	extractNextPage(response: ProviderResponse): PageInfo | null {
		const meta = (response.data as { resultSetMetaData?: { partitionInfo?: unknown[] } } | undefined)
			?.resultSetMetaData;
		const partitions = meta?.partitionInfo;
		if (Array.isArray(partitions) && partitions.length > 1) {
			return { hasMore: true, nextOffset: 1, total: partitions.length };
		}
		return null;
	}

	extractRateLimitInfo(_response: Response): RateLimitInfo | null {
		return null;
	}
}

const snowflakeProvider = new SnowflakeProvider();
registerProvider(snowflakeProvider);

export { snowflakeProvider };
export { SNOWFLAKE_CONFIG } from './config';
