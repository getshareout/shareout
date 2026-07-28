import type { Env } from '../../types';
export type { Env };

export type ExecutionMode = 'direct' | 'proxy' | 'auto';
export type AuthType = 'oauth2' | 'api_key' | 'basic' | 'bearer' | 'custom';
export type PaginationType = 'cursor' | 'offset' | 'page' | 'link' | 'none';

export interface OAuthConfig {
	authorizationUrl: string;
	tokenUrl: string;
	revokeUrl?: string;
	pkceRequired: boolean;
	scopes: string[];
	clientIdEnvVar: string;
	clientSecretEnvVar: string;
}

export interface ApiKeyConfig {
	headerName: string;
	prefix?: string;
	queryParam?: string;
}

export interface ProviderConfig {
	id: string;
	name: string;
	version: string;

	execution: {
		defaultMode: ExecutionMode;
		directSupported: boolean;
		proxyRequired: boolean;
		corsAllowed: string[];
	};

	auth: {
		type: AuthType;
		oauth?: OAuthConfig;
		apiKey?: ApiKeyConfig;
		scopes?: string[];
		refreshable: boolean;
		expiresInSeconds?: number;
	};

	rateLimit: {
		requestsPerMinute: number;
		requestsPerSecond?: number;
		burstLimit?: number;
		quotaTracking: 'per-provider' | 'per-connection' | 'per-artifact';
	};

	cache: {
		defaultTtlSeconds: number;
		maxTtlSeconds: number;
		persistable: boolean;
		userRefreshable: boolean;
	};

	api: {
		baseUrl: string;
		version?: string;
		defaultHeaders?: Record<string, string>;
	};

	pagination: {
		type: PaginationType;
		defaultLimit: number;
		maxLimit: number;
		cursorField?: string;
		nextLinkField?: string;
	};

	// Catalog presentation. Optional: providers without it are hidden from the
	// admin connectors catalog grid (still reachable via the generic add flow).
	display?: ProviderDisplay;
}

export type ConnectMethod = 'oauth' | 'oauth_shop' | 'token' | 'key_pair' | 'service_account';

export interface ProviderDisplay {
	// Short label shown on the card (falls back to ProviderConfig.name).
	label?: string;
	// Catalog grouping, e.g. 'analytics', 'ecommerce', 'ads', 'warehouse', 'messaging'.
	category: string;
	// One-line description shown under the label.
	tagline?: string;
	// Accent color for the card icon.
	color?: string;
	// Inline SVG inner markup (paths) for the card icon, no <svg> wrapper.
	iconSvg?: string;
	// How a member connects this provider from the catalog.
	connectMethod: ConnectMethod;
	// Link to provider docs explaining where to get the credentials.
	docsUrl?: string;
	// Example artifact snippet shown after connecting; __NAME__ is replaced with
	// the connection name the user chose.
	exampleSnippet?: string;
	// Whether a Test button (provider.verifyConnection) is available.
	testable?: boolean;
	// Hide from the catalog grid even though the provider is registered.
	hidden?: boolean;
}

export interface ProviderEndpoint {
	id: string;
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	path: string;
	description?: string;

	execution?: {
		mode?: ExecutionMode;
		directAllowed?: boolean;
		requiresProxy?: boolean;
	};

	pagination?: Partial<{
		type: PaginationType;
		defaultLimit: number;
		maxLimit: number;
		cursorField: string;
	}>;

	cache?: {
		ttlSeconds?: number;
		key?: (params: unknown) => string;
	};

	transform?: {
		request?: (params: unknown) => unknown;
		response?: (data: unknown) => unknown;
	};
}

export interface TokenResult {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	scope?: string;
	tokenType?: string;
	extra?: Record<string, unknown>;
}

export interface DirectCredentials {
	accessToken: string;
	expiresAt: number;
	authHeader: string;
	headerName: string;
	allowedEndpoints?: string[];
	allowedHosts?: string[];
}

export interface CredentialExchangeResult {
	mode: 'direct' | 'proxy';
	direct?: DirectCredentials;
	proxyToken?: string;
	expiresAt: number;
}

export interface RequestParams {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	pathParams?: Record<string, string | number>;
	queryParams?: Record<string, string | number | boolean>;
	body?: unknown;
	headers?: Record<string, string>;
}

export interface PlatformRequest {
	provider: string;
	endpoint: string;
	connectionId: string;
	params?: RequestParams;
	options?: {
		cache?: boolean;
		cacheTtl?: number;
		forceRefresh?: boolean;
		executionMode?: ExecutionMode;
		pagination?: {
			cursor?: string;
			limit?: number;
			offset?: number;
		};
	};
}

export interface PlatformError {
	code: string;
	message: string;
	provider?: string;
	httpStatus?: number;
	retryable: boolean;
	retryAfterMs?: number;
}

export interface PageInfo {
	hasMore: boolean;
	cursor?: string;
	nextOffset?: number;
	total?: number;
}

export interface RateLimitInfo {
	remaining: number;
	limit: number;
	resetAt?: number;
}

export interface PlatformResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: PlatformError;

	meta: {
		provider: string;
		endpoint: string;
		executionMode: ExecutionMode;
		cached: boolean;
		cachedAt?: string;
		executionTimeMs: number;
	};

	pagination?: PageInfo;
	rateLimit?: RateLimitInfo;
}

export interface CacheEntry<T = unknown> {
	data: T;
	createdAt: number;
	expiresAt: number;
	provider: string;
	endpoint: string;
	queryHash: string;
	userRefreshable: boolean;
}

export interface ConnectionConfig {
	id: string;
	name: string;
	provider: string;
	preferredMode: ExecutionMode;
	config: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface AuthContext {
	artifactId: string;
	connectionId: string;
	callbackUrl: string;
	state: string;
	params: Record<string, string>;
	env: Env;
}

export interface ExecutionContext {
	artifactId: string;
	connectionId: string;
	connectionConfig: ConnectionConfig;
	credentials: DecryptedCredentials;
	env: Env;
	requestOrigin?: string;
}

export interface DecryptedCredentials {
	access_token: string;
	refresh_token?: string;
	/** Epoch milliseconds, from the OAuth provider. Lives inside the encrypted blob,
	 *  not in a column — this is deliberately not the TEXT timestamp convention. */
	expires_at?: number;
	extra?: Record<string, unknown>;
}

export interface EncryptedCredentials {
	encrypted_data: string;
	iv: string;
}

export const PLATFORM_ERRORS = {
	PROVIDER_NOT_FOUND: {
		code: 'PROVIDER_NOT_FOUND',
		message: 'Provider not registered',
		httpStatus: 404,
	},
	CONNECTION_NOT_FOUND: {
		code: 'CONNECTION_NOT_FOUND',
		message: 'Connection not found',
		httpStatus: 404,
	},
	ENDPOINT_NOT_FOUND: {
		code: 'ENDPOINT_NOT_FOUND',
		message: 'Endpoint not found for provider',
		httpStatus: 404,
	},
	AUTH_REQUIRED: {
		code: 'AUTH_REQUIRED',
		message: 'Authentication required for this provider',
		httpStatus: 401,
	},
	DIRECT_NOT_SUPPORTED: {
		code: 'DIRECT_NOT_SUPPORTED',
		message: 'Provider does not support direct mode',
		httpStatus: 400,
	},
	RATE_LIMITED: {
		code: 'RATE_LIMITED',
		message: 'Rate limit exceeded',
		httpStatus: 429,
	},
	PROVIDER_ERROR: {
		code: 'PROVIDER_ERROR',
		message: 'Provider returned an error',
		httpStatus: 502,
	},
	INVALID_CREDENTIALS: {
		code: 'INVALID_CREDENTIALS',
		message: 'Invalid or expired credentials',
		httpStatus: 401,
	},
	CREDENTIALS_REQUIRED: {
		code: 'CREDENTIALS_REQUIRED',
		message: 'Connect your credentials for this connector before querying',
		httpStatus: 403,
	},
	CACHE_ERROR: {
		code: 'CACHE_ERROR',
		message: 'Cache operation failed',
		httpStatus: 500,
	},
	SCOPE_REQUIRED: {
		code: 'SCOPE_REQUIRED',
		message: 'This artifact has a row-level access policy; the query must reference :viewer_scope (e.g. WHERE company_id IN (:viewer_scope)) so the server can enforce per-viewer filtering',
		httpStatus: 403,
	},
} as const;
