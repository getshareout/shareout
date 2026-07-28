import { BaseProvider, type ProviderResponse, type VerifyResult } from '../base-provider';
import { getPlatformHostname } from '../../../../config/origins';
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
import { TIENDANUBE_CONFIG, TIENDANUBE_API_VERSION } from './config';
import { registerProvider } from '../../registry';
import { createLogger, logError } from '../../../../logging';
import {
	userFacingAuthTokenError,
	userFacingProviderUpstreamError,
	userFacingVerifyUpstreamError,
} from '../../errors';

interface TiendanubeConnectionConfig {
	store_id?: string;
	region?: 'ar' | 'br';
}

class TiendanubeProvider extends BaseProvider {
	readonly config = TIENDANUBE_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>([
		// Products
		[
			'products.list',
			{
				id: 'products.list',
				method: 'GET',
				path: '/products',
				description: 'List all products',
				cache: { ttlSeconds: 300 },
				pagination: { type: 'page', defaultLimit: 30, maxLimit: 200 },
			},
		],
		[
			'products.get',
			{
				id: 'products.get',
				method: 'GET',
				path: '/products/{id}',
				description: 'Get a single product by ID',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'products.getBySku',
			{
				id: 'products.getBySku',
				method: 'GET',
				path: '/products/sku/{sku}',
				description: 'Get a product by variant SKU',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'products.create',
			{
				id: 'products.create',
				method: 'POST',
				path: '/products',
				description: 'Create a new product',
			},
		],
		[
			'products.update',
			{
				id: 'products.update',
				method: 'PUT',
				path: '/products/{id}',
				description: 'Update a product',
			},
		],
		[
			'products.delete',
			{
				id: 'products.delete',
				method: 'DELETE',
				path: '/products/{id}',
				description: 'Delete a product',
			},
		],
		[
			'products.bulkUpdate',
			{
				id: 'products.bulkUpdate',
				method: 'PATCH',
				path: '/products/stock-price',
				description: 'Bulk update stock and price (max 50 variants)',
			},
		],

		// Product Variants
		[
			'variants.list',
			{
				id: 'variants.list',
				method: 'GET',
				path: '/products/{product_id}/variants',
				description: 'List variants for a product',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'variants.get',
			{
				id: 'variants.get',
				method: 'GET',
				path: '/products/{product_id}/variants/{id}',
				description: 'Get a single variant',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'variants.create',
			{
				id: 'variants.create',
				method: 'POST',
				path: '/products/{product_id}/variants',
				description: 'Create a variant',
			},
		],
		[
			'variants.update',
			{
				id: 'variants.update',
				method: 'PUT',
				path: '/products/{product_id}/variants/{id}',
				description: 'Update a variant',
			},
		],
		[
			'variants.delete',
			{
				id: 'variants.delete',
				method: 'DELETE',
				path: '/products/{product_id}/variants/{id}',
				description: 'Delete a variant',
			},
		],

		// Product Images
		[
			'images.list',
			{
				id: 'images.list',
				method: 'GET',
				path: '/products/{product_id}/images',
				description: 'List images for a product',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'images.create',
			{
				id: 'images.create',
				method: 'POST',
				path: '/products/{product_id}/images',
				description: 'Add an image to a product',
			},
		],
		[
			'images.update',
			{
				id: 'images.update',
				method: 'PUT',
				path: '/products/{product_id}/images/{id}',
				description: 'Update an image',
			},
		],
		[
			'images.delete',
			{
				id: 'images.delete',
				method: 'DELETE',
				path: '/products/{product_id}/images/{id}',
				description: 'Delete an image',
			},
		],

		// Orders
		[
			'orders.list',
			{
				id: 'orders.list',
				method: 'GET',
				path: '/orders',
				description: 'List all orders',
				cache: { ttlSeconds: 60 },
				pagination: { type: 'page', defaultLimit: 30, maxLimit: 200 },
			},
		],
		[
			'orders.get',
			{
				id: 'orders.get',
				method: 'GET',
				path: '/orders/{id}',
				description: 'Get a single order by ID',
				cache: { ttlSeconds: 60 },
			},
		],
		[
			'orders.create',
			{
				id: 'orders.create',
				method: 'POST',
				path: '/orders',
				description: 'Create a new order',
			},
		],
		[
			'orders.update',
			{
				id: 'orders.update',
				method: 'PUT',
				path: '/orders/{id}',
				description: 'Update an order',
			},
		],
		[
			'orders.close',
			{
				id: 'orders.close',
				method: 'POST',
				path: '/orders/{id}/close',
				description: 'Archive an order',
			},
		],
		[
			'orders.open',
			{
				id: 'orders.open',
				method: 'POST',
				path: '/orders/{id}/open',
				description: 'Reopen an archived order',
			},
		],
		[
			'orders.cancel',
			{
				id: 'orders.cancel',
				method: 'POST',
				path: '/orders/{id}/cancel',
				description: 'Cancel an order',
			},
		],

		// Fulfillment Orders
		[
			'fulfillments.list',
			{
				id: 'fulfillments.list',
				method: 'GET',
				path: '/orders/{order_id}/fulfillment_orders',
				description: 'List fulfillment orders',
				cache: { ttlSeconds: 60 },
			},
		],

		// Customers
		[
			'customers.list',
			{
				id: 'customers.list',
				method: 'GET',
				path: '/customers',
				description: 'List all customers',
				cache: { ttlSeconds: 300 },
				pagination: { type: 'page', defaultLimit: 30, maxLimit: 200 },
			},
		],
		[
			'customers.get',
			{
				id: 'customers.get',
				method: 'GET',
				path: '/customers/{id}',
				description: 'Get a single customer by ID',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'customers.create',
			{
				id: 'customers.create',
				method: 'POST',
				path: '/customers',
				description: 'Create a new customer',
			},
		],
		[
			'customers.update',
			{
				id: 'customers.update',
				method: 'PUT',
				path: '/customers/{id}',
				description: 'Update a customer',
			},
		],
		[
			'customers.delete',
			{
				id: 'customers.delete',
				method: 'DELETE',
				path: '/customers/{id}',
				description: 'Delete a customer (only if no orders)',
			},
		],

		// Categories
		[
			'categories.list',
			{
				id: 'categories.list',
				method: 'GET',
				path: '/categories',
				description: 'List all categories',
				cache: { ttlSeconds: 300 },
				pagination: { type: 'page', defaultLimit: 30, maxLimit: 200 },
			},
		],
		[
			'categories.get',
			{
				id: 'categories.get',
				method: 'GET',
				path: '/categories/{id}',
				description: 'Get a single category by ID',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'categories.create',
			{
				id: 'categories.create',
				method: 'POST',
				path: '/categories',
				description: 'Create a new category',
			},
		],
		[
			'categories.update',
			{
				id: 'categories.update',
				method: 'PUT',
				path: '/categories/{id}',
				description: 'Update a category',
			},
		],
		[
			'categories.delete',
			{
				id: 'categories.delete',
				method: 'DELETE',
				path: '/categories/{id}',
				description: 'Delete a category',
			},
		],

		// Coupons
		[
			'coupons.list',
			{
				id: 'coupons.list',
				method: 'GET',
				path: '/coupons',
				description: 'List all coupons',
				cache: { ttlSeconds: 300 },
				pagination: { type: 'page', defaultLimit: 30, maxLimit: 200 },
			},
		],
		[
			'coupons.get',
			{
				id: 'coupons.get',
				method: 'GET',
				path: '/coupons/{id}',
				description: 'Get a single coupon by ID',
				cache: { ttlSeconds: 300 },
			},
		],
		[
			'coupons.create',
			{
				id: 'coupons.create',
				method: 'POST',
				path: '/coupons',
				description: 'Create a new coupon',
			},
		],
		[
			'coupons.update',
			{
				id: 'coupons.update',
				method: 'PUT',
				path: '/coupons/{id}',
				description: 'Update a coupon',
			},
		],
		[
			'coupons.delete',
			{
				id: 'coupons.delete',
				method: 'DELETE',
				path: '/coupons/{id}',
				description: 'Delete a coupon',
			},
		],

		// Store Info
		[
			'store.get',
			{
				id: 'store.get',
				method: 'GET',
				path: '/store',
				description: 'Get store information',
				cache: { ttlSeconds: 3600 },
			},
		],

		// Webhooks
		[
			'webhooks.list',
			{
				id: 'webhooks.list',
				method: 'GET',
				path: '/webhooks',
				description: 'List all webhooks',
				cache: { ttlSeconds: 60 },
			},
		],
		[
			'webhooks.get',
			{
				id: 'webhooks.get',
				method: 'GET',
				path: '/webhooks/{id}',
				description: 'Get a single webhook',
				cache: { ttlSeconds: 60 },
			},
		],
		[
			'webhooks.create',
			{
				id: 'webhooks.create',
				method: 'POST',
				path: '/webhooks',
				description: 'Create a new webhook',
			},
		],
		[
			'webhooks.update',
			{
				id: 'webhooks.update',
				method: 'PUT',
				path: '/webhooks/{id}',
				description: 'Update a webhook',
			},
		],
		[
			'webhooks.delete',
			{
				id: 'webhooks.delete',
				method: 'DELETE',
				path: '/webhooks/{id}',
				description: 'Delete a webhook',
			},
		],

		// Locations (inventory)
		[
			'locations.list',
			{
				id: 'locations.list',
				method: 'GET',
				path: '/locations',
				description: 'List inventory locations',
				cache: { ttlSeconds: 600 },
			},
		],
	]);

	async getAuthUrl(ctx: AuthContext): Promise<string> {
		const appId = ctx.env.TIENDANUBE_CLIENT_ID;
		if (!appId) {
			throw new Error('TIENDANUBE_CLIENT_ID is required for OAuth');
		}

		const params = new URLSearchParams({
			state: ctx.state,
		});

		return `https://www.tiendanube.com/apps/${appId}/authorize?${params}`;
	}

	async handleCallback(ctx: AuthContext, code: string): Promise<TokenResult> {
		const response = await fetch(
			'https://www.tiendanube.com/apps/authorize/token',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					client_id: ctx.env.TIENDANUBE_CLIENT_ID,
					client_secret: ctx.env.TIENDANUBE_CLIENT_SECRET,
					grant_type: 'authorization_code',
					code,
				}),
			}
		);

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'tiendanube',
					event: 'oauth.token.failed',
					http_status: response.status,
				}),
				'Tienda Nube OAuth token exchange failed',
				new Error(`HTTP ${response.status}`),
			);
			throw new Error(userFacingAuthTokenError(new Error(`HTTP ${response.status}`)));
		}

		const data = (await response.json()) as {
			access_token: string;
			token_type: string;
			scope: string;
			user_id: number;
		};

		return {
			accessToken: data.access_token,
			tokenType: data.token_type,
			scope: data.scope,
			extra: {
				store_id: String(data.user_id),
			},
		};
	}

	async refreshToken(
		_ctx: AuthContext,
		_refreshToken: string
	): Promise<TokenResult> {
		throw new Error('Tienda Nube access tokens do not expire and cannot be refreshed');
	}

	async prepareDirectCredentials(
		_ctx: AuthContext,
		_credentials: DecryptedCredentials
	): Promise<DirectCredentials> {
		throw new Error('Tienda Nube does not support direct mode due to CORS restrictions');
	}

	async verifyConnection(
		env: Env,
		config: Record<string, unknown>,
		credentials: DecryptedCredentials
	): Promise<VerifyResult> {
		const storeId = config.store_id as string;
		if (!storeId) return { ok: false, message: 'Store ID is required' };
		const region = (config.region as string) || 'ar';
		const baseHost = region === 'br' ? 'api.nuvemshop.com.br' : 'api.tiendanube.com';
		const res = await fetch(`https://${baseHost}/${TIENDANUBE_API_VERSION}/${storeId}/store`, {
			headers: {
				'Authentication': `bearer ${credentials.access_token}`,
				'Content-Type': 'application/json',
				'User-Agent': `ShareOut Data Platform (support@${getPlatformHostname(env)})`,
			},
		});
		if (res.ok) return { ok: true, message: `Connected to store ${storeId}` };
		if (res.status === 401) return { ok: false, message: 'Token rejected by Tienda Nube' };
		logError(
			createLogger(env, {
				scope: 'platform',
				provider: 'tiendanube',
				event: 'verify.upstream.failed',
				http_status: res.status,
			}),
			'Tienda Nube verify: store probe failed',
			new Error(`HTTP ${res.status}`),
		);
		return { ok: false, message: userFacingVerifyUpstreamError(res.status) };
	}

	async executeRequest<T = unknown>(
		ctx: ExecutionContext,
		endpoint: ProviderEndpoint,
		params: RequestParams
	): Promise<ProviderResponse<T>> {
		const config = ctx.connectionConfig.config as TiendanubeConnectionConfig;
		const storeId = config.store_id;

		if (!storeId) {
			return {
				success: false,
				error: {
					code: 'MISSING_STORE_ID',
					message: 'Store ID is required in connection config',
				},
			};
		}

		const region = config.region || 'ar';
		const baseHost = region === 'br' ? 'api.nuvemshop.com.br' : 'api.tiendanube.com';
		const baseUrl = `https://${baseHost}/${TIENDANUBE_API_VERSION}/${storeId}`;
		const url = this.buildUrl(baseUrl, endpoint, params);

		const response = await fetch(url, {
			method: endpoint.method,
			headers: {
				'Authentication': `bearer ${ctx.credentials.access_token}`,
				'Content-Type': 'application/json',
				'User-Agent': `ShareOut Data Platform (support@${getPlatformHostname(ctx.env)})`,
			},
			body: params.body ? JSON.stringify(params.body) : undefined,
		});

		const rateLimit = this.extractRateLimitInfo(response);

		if (!response.ok) {
			logError(
				createLogger(ctx.env, {
					scope: 'platform',
					provider: 'tiendanube',
					event: 'execute.upstream.failed',
					http_status: response.status,
				}),
				'Tienda Nube execute: upstream request failed',
				new Error(`HTTP ${response.status}`),
			);
			return {
				success: false,
				status: response.status,
				error: {
					code: `TIENDANUBE_${response.status}`,
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
		const totalCount = response.headers?.get('x-total-count');

		if (!linkHeader) {
			return totalCount
				? { hasMore: false, total: parseInt(totalCount, 10) }
				: null;
		}

		const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
		if (!nextMatch) {
			return totalCount
				? { hasMore: false, total: parseInt(totalCount, 10) }
				: null;
		}

		const nextUrl = new URL(nextMatch[1]);
		const page = nextUrl.searchParams.get('page');

		return {
			hasMore: true,
			cursor: page || undefined,
			total: totalCount ? parseInt(totalCount, 10) : undefined,
		};
	}

	extractRateLimitInfo(response: Response): RateLimitInfo | null {
		const limit = response.headers.get('x-rate-limit-limit');
		const remaining = response.headers.get('x-rate-limit-remaining');
		const reset = response.headers.get('x-rate-limit-reset');

		if (!limit || !remaining) return null;

		return {
			limit: parseInt(limit, 10),
			remaining: parseInt(remaining, 10),
			resetAt: reset ? parseInt(reset, 10) * 1000 : undefined,
		};
	}
}

const tiendanubeProvider = new TiendanubeProvider();
registerProvider(tiendanubeProvider);

export { tiendanubeProvider };
export { TIENDANUBE_CONFIG } from './config';
