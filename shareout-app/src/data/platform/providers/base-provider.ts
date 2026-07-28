import type {
	ProviderConfig,
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
} from '../types';

export interface VerifyResult {
	ok: boolean;
	message?: string;
}

export interface ProviderResponse<T = unknown> {
	success: boolean;
	data?: T;
	headers?: Headers;
	status?: number;
	rateLimit?: RateLimitInfo;
	pagination?: PageInfo;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
}

export abstract class BaseProvider {
	abstract readonly config: ProviderConfig;
	abstract readonly endpoints: Map<string, ProviderEndpoint>;

	abstract getAuthUrl(ctx: AuthContext): Promise<string>;

	abstract handleCallback(ctx: AuthContext, code: string): Promise<TokenResult>;

	abstract refreshToken(
		ctx: AuthContext,
		refreshToken: string
	): Promise<TokenResult>;

	abstract prepareDirectCredentials(
		ctx: AuthContext,
		credentials: DecryptedCredentials
	): Promise<DirectCredentials>;

	abstract executeRequest<T = unknown>(
		ctx: ExecutionContext,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): Promise<ProviderResponse<T>>;

	abstract extractNextPage(response: ProviderResponse): PageInfo | null;

	abstract extractRateLimitInfo(response: Response): RateLimitInfo | null;

	// Optional cheap credential probe powering the admin "Test" button. Providers
	// that implement it return {ok} after a lightweight authenticated call.
	verifyConnection?(
		env: Env,
		config: Record<string, unknown>,
		credentials: DecryptedCredentials
	): Promise<VerifyResult>;

	getEndpoint(id: string): ProviderEndpoint | undefined {
		return this.endpoints.get(id);
	}

	listEndpoints(): ProviderEndpoint[] {
		return Array.from(this.endpoints.values());
	}

	buildUrl(
		baseUrl: string,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): string {
		let path = endpoint.path;

		for (const [key, value] of Object.entries(params.pathParams || {})) {
			path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
		}

		const url = new URL(path, baseUrl);

		for (const [key, value] of Object.entries(params.queryParams || {})) {
			if (value !== undefined && value !== null) {
				url.searchParams.set(key, String(value));
			}
		}

		return url.toString();
	}

	supportsDirectMode(): boolean {
		return this.config.execution.directSupported && !this.config.execution.proxyRequired;
	}

	requiresProxy(): boolean {
		return this.config.execution.proxyRequired;
	}

	getDefaultCacheTtl(): number {
		return this.config.cache.defaultTtlSeconds * 1000;
	}

	isUserRefreshable(): boolean {
		return this.config.cache.userRefreshable;
	}
}
