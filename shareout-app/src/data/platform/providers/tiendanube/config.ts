import type { ProviderConfig } from '../../types';

export const TIENDANUBE_CONFIG: ProviderConfig = {
	id: 'tiendanube',
	name: 'Tienda Nube',
	version: '2025-03',

	execution: {
		defaultMode: 'proxy',
		directSupported: false,
		proxyRequired: true,
		corsAllowed: [],
	},

	auth: {
		type: 'oauth2',
		oauth: {
			authorizationUrl: 'https://www.tiendanube.com/apps/{app_id}/authorize',
			tokenUrl: 'https://www.tiendanube.com/apps/authorize/token',
			revokeUrl: undefined,
			pkceRequired: false,
			scopes: [
				'read_products',
				'write_products',
				'read_orders',
				'write_orders',
				'read_customers',
				'write_customers',
				'read_coupons',
			],
			clientIdEnvVar: 'TIENDANUBE_CLIENT_ID',
			clientSecretEnvVar: 'TIENDANUBE_CLIENT_SECRET',
		},
		refreshable: false,
		expiresInSeconds: undefined,
	},

	rateLimit: {
		requestsPerMinute: 80,
		requestsPerSecond: 2,
		burstLimit: 40,
		quotaTracking: 'per-connection',
	},

	cache: {
		defaultTtlSeconds: 300,
		maxTtlSeconds: 3600,
		persistable: true,
		userRefreshable: true,
	},

	api: {
		baseUrl: 'https://api.tiendanube.com/{version}/{store_id}',
		version: '2025-03',
		defaultHeaders: {
			'Content-Type': 'application/json',
		},
	},

	pagination: {
		type: 'page',
		defaultLimit: 30,
		maxLimit: 200,
	},

	display: {
		label: 'Tienda Nube',
		category: 'ecommerce',
		tagline: 'Orders, products & store revenue',
		color: '#2E52C2',
		connectMethod: 'token',
		testable: true,
		docsUrl: 'https://tiendanube.github.io/api-documentation/authentication',
		iconSvg: '<path d="M17 18a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1.5A4 4 0 0 0 7 18z"/>',
		exampleSnippet: "const store = so.connection('__NAME__');\nconst orders = await store.fetch({ endpoint: 'orders.list', params: { per_page: 50 } });",
	},
};

export const TIENDANUBE_API_VERSION = '2025-03';
