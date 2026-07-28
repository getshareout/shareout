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
import { SHOPIFY_CONFIG, SHOPIFY_API_VERSION } from './config';
import { registerProvider } from '../../registry';
import { createLogger, logError } from '../../../../logging';
import {
	userFacingAuthTokenError,
	userFacingProviderUpstreamError,
	userFacingVerifyUpstreamError,
} from '../../errors';

interface ShopifyConnectionConfig {
	shop?: string;
}

class ShopifyProvider extends BaseProvider {
	readonly config = SHOPIFY_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>([
		[
			'products.list',
			{
				id: 'products.list',
				method: 'GET',
				path: '/products.json',
				description: 'List all products',
				cache: { ttlSeconds: 300 },
				pagination: { type: 'link', defaultLimit: 50, maxLimit: 250 },
			},
		],
		[
			'products.get',
			{
				id: 'products.get',
				method: 'GET',
				path: '/products/{id}.json',
				description: 'Get a single product by ID',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'products.count',
			{
				id: 'products.count',
				method: 'GET',
				path: '/products/count.json',
				description: 'Get product count',
				cache: { ttlSeconds: 60 },
			},
		],
		[
			'products.create',
			{
				id: 'products.create',
				method: 'POST',
				path: '/products.json',
				description: 'Create a new product',
			},
		],
		[
			'products.update',
			{
				id: 'products.update',
				method: 'PUT',
				path: '/products/{id}.json',
				description: 'Update a product',
			},
		],
		[
			'orders.list',
			{
				id: 'orders.list',
				method: 'GET',
				path: '/orders.json',
				description: 'List all orders',
				cache: { ttlSeconds: 60 },
				pagination: { type: 'link', defaultLimit: 50, maxLimit: 250 },
			},
		],
		[
			'orders.get',
			{
				id: 'orders.get',
				method: 'GET',
				path: '/orders/{id}.json',
				description: 'Get a single order by ID',
				cache: { ttlSeconds: 60 },
			},
		],
		[
			'orders.count',
			{
				id: 'orders.count',
				method: 'GET',
				path: '/orders/count.json',
				description: 'Get order count',
				cache: { ttlSeconds: 60 },
			},
		],
		[
			'customers.list',
			{
				id: 'customers.list',
				method: 'GET',
				path: '/customers.json',
				description: 'List all customers',
				cache: { ttlSeconds: 300 },
				pagination: { type: 'link', defaultLimit: 50, maxLimit: 250 },
			},
		],
		[
			'customers.get',
			{
				id: 'customers.get',
				method: 'GET',
				path: '/customers/{id}.json',
				description: 'Get a single customer by ID',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'customers.count',
			{
				id: 'customers.count',
				method: 'GET',
				path: '/customers/count.json',
				description: 'Get customer count',
				cache: { ttlSeconds: 60 },
			},
		],
		[
			'inventory.levels',
			{
				id: 'inventory.levels',
				method: 'GET',
				path: '/inventory_levels.json',
				description: 'Get inventory levels',
				cache: { ttlSeconds: 60 },
				pagination: { type: 'link', defaultLimit: 50, maxLimit: 250 },
			},
		],
		[
			'inventory.locations',
			{
				id: 'inventory.locations',
				method: 'GET',
				path: '/locations.json',
				description: 'List inventory locations',
				cache: { ttlSeconds: 600 },
			},
		],
		[
			'shop.get',
			{
				id: 'shop.get',
				method: 'GET',
				path: '/shop.json',
				description: 'Get shop information',
				cache: { ttlSeconds: 3600 },
			},
		],
		[
			'collections.list',
			{
				id: 'collections.list',
				method: 'GET',
				path: '/custom_collections.json',
				description: 'List custom collections',
				cache: { ttlSeconds: 300 },
				pagination: { type: 'link', defaultLimit: 50, maxLimit: 250 },
			},
		],
		[
			'smartCollections.list',
			{
				id: 'smartCollections.list',
				method: 'GET',
				path: '/smart_collections.json',
				description: 'List smart collections',
				cache: { ttlSeconds: 300 },
				pagination: { type: 'link', defaultLimit: 50, maxLimit: 250 },
			},
		],
	]);

	async getAuthUrl(ctx: AuthContext): Promise<string> {
		const { shop } = ctx.params;
		if (!shop) {
			throw new Error('Shop name is required for Shopify OAuth');
		}

		const config = this.config.auth.oauth!;
		const params = new URLSearchParams({
			client_id: ctx.env.SHOPIFY_CLIENT_ID,
			scope: config.scopes.join(','),
			redirect_uri: ctx.callbackUrl,
			state: ctx.state,
		});

		return `https://${shop}.myshopify.com/admin/oauth/authorize?${params}`;
	}

	async handleCallback(ctx: AuthContext, code: string): Promise<TokenResult> {
		const { shop } = ctx.params;
		if (!shop) {
			throw new Error('Shop name is required for token exchange');
		}

		const response = await fetch(
			`https://${shop}.myshopify.com/admin/oauth/access_token`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					client_id: ctx.env.SHOPIFY_CLIENT_ID,
					client_secret: ctx.env.SHOPIFY_CLIENT_SECRET,
					code,
				}),
			}
		);

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'shopify',
					event: 'oauth.token.failed',
					http_status: response.status,
				}),
				'Shopify OAuth token exchange failed',
				new Error(`HTTP ${response.status}`),
			);
			throw new Error(userFacingAuthTokenError(new Error(`HTTP ${response.status}`)));
		}

		const data = (await response.json()) as {
			access_token: string;
			scope: string;
		};

		return {
			accessToken: data.access_token,
			scope: data.scope,
			extra: { shop },
		};
	}

	async refreshToken(
		_ctx: AuthContext,
		_refreshToken: string
	): Promise<TokenResult> {
		throw new Error('Shopify access tokens do not expire and cannot be refreshed');
	}

	async verifyConnection(
		env: Env,
		config: Record<string, unknown>,
		credentials: DecryptedCredentials
	): Promise<VerifyResult> {
		const shop = (config.shop as string || '').replace('.myshopify.com', '');
		if (!shop) return { ok: false, message: 'Shop domain is required' };
		const res = await fetch(`https://${shop}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
			headers: { 'X-Shopify-Access-Token': credentials.access_token, 'Content-Type': 'application/json' },
		});
		if (res.ok) return { ok: true, message: `Connected to ${shop}.myshopify.com` };
		if (res.status === 401 || res.status === 403) {
			return { ok: false, message: 'Token rejected by Shopify' };
		}
		logError(
			createLogger(env, {
				scope: 'platform',
				provider: 'shopify',
				event: 'verify.upstream.failed',
				http_status: res.status,
			}),
			'Shopify verify: shop probe failed',
			new Error(`HTTP ${res.status}`),
		);
		return { ok: false, message: userFacingVerifyUpstreamError(res.status) };
	}

	async prepareDirectCredentials(
		_ctx: AuthContext,
		_credentials: DecryptedCredentials
	): Promise<DirectCredentials> {
		throw new Error('Shopify does not support direct mode due to CORS restrictions');
	}

	async executeRequest<T = unknown>(
		ctx: ExecutionContext,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): Promise<ProviderResponse<T>> {
		const shopConfig = ctx.connectionConfig.config as ShopifyConnectionConfig;
		const shop = shopConfig.shop;

		if (!shop) {
			return {
				success: false,
				error: {
					code: 'MISSING_SHOP',
					message: 'Shop name is required in connection config',
				},
			};
		}

		const baseUrl = `https://${shop}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;
		const url = this.buildUrl(baseUrl, endpoint, params);

		const response = await fetch(url, {
			method: endpoint.method,
			headers: {
				'X-Shopify-Access-Token': ctx.credentials.access_token,
				'Content-Type': 'application/json',
			},
			body: params.body ? JSON.stringify(params.body) : undefined,
		});

		const rateLimit = this.extractRateLimitInfo(response);

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'shopify',
					event: 'execute.upstream.failed',
					http_status: response.status,
				}),
				'Shopify execute: upstream request failed',
				new Error(`HTTP ${response.status}`),
			);
			return {
				success: false,
				status: response.status,
				error: {
					code: `SHOPIFY_${response.status}`,
					message: userFacingProviderUpstreamError(response.status),
				},
				rateLimit: rateLimit || undefined,
			};
		}

		const data = (await response.json()) as T;
		const pagination = this.extractNextPage({
			success: true,
			headers: response.headers,
			data,
		});

		return {
			success: true,
			data,
			status: response.status,
			headers: response.headers,
			rateLimit: rateLimit || undefined,
			pagination: pagination || undefined,
		};
	}

	extractNextPage(response: ProviderResponse): PageInfo | null {
		const linkHeader = response.headers?.get('Link');
		if (!linkHeader) return null;

		const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
		if (!nextMatch) return null;

		const nextUrl = new URL(nextMatch[1]);
		const pageInfo = nextUrl.searchParams.get('page_info');

		return {
			hasMore: true,
			cursor: pageInfo || nextMatch[1],
		};
	}

	extractRateLimitInfo(response: Response): RateLimitInfo | null {
		const callLimit = response.headers.get('X-Shopify-Shop-Api-Call-Limit');
		if (!callLimit) return null;

		const [current, max] = callLimit.split('/').map(Number);
		if (isNaN(current) || isNaN(max)) return null;

		return {
			remaining: max - current,
			limit: max,
		};
	}
}

const shopifyProvider = new ShopifyProvider();
registerProvider(shopifyProvider);

export { shopifyProvider };
export { SHOPIFY_CONFIG } from './config';
