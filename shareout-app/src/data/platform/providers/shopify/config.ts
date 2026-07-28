import type { ProviderConfig } from '../../types';

export const SHOPIFY_CONFIG: ProviderConfig = {
	id: 'shopify',
	name: 'Shopify',
	version: '2024-01',

	execution: {
		defaultMode: 'proxy',
		directSupported: false,
		proxyRequired: true,
		corsAllowed: [],
	},

	auth: {
		type: 'oauth2',
		oauth: {
			authorizationUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
			tokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
			revokeUrl: undefined,
			pkceRequired: false,
			scopes: [
				'read_products',
				'write_products',
				'read_orders',
				'read_customers',
				'read_inventory',
			],
			clientIdEnvVar: 'SHOPIFY_CLIENT_ID',
			clientSecretEnvVar: 'SHOPIFY_CLIENT_SECRET',
		},
		refreshable: false,
		expiresInSeconds: undefined,
	},

	rateLimit: {
		requestsPerMinute: 80,
		requestsPerSecond: 2,
		burstLimit: 4,
		quotaTracking: 'per-connection',
	},

	cache: {
		defaultTtlSeconds: 300,
		maxTtlSeconds: 3600,
		persistable: true,
		userRefreshable: true,
	},

	api: {
		baseUrl: 'https://{shop}.myshopify.com/admin/api/{version}',
		version: '2024-01',
		defaultHeaders: {
			'Content-Type': 'application/json',
		},
	},

	pagination: {
		type: 'link',
		defaultLimit: 50,
		maxLimit: 250,
		nextLinkField: 'rel="next"',
	},

	display: {
		label: 'Shopify',
		category: 'ecommerce',
		tagline: 'Orders, products & store revenue',
		color: '#95BF47',
		connectMethod: 'token',
		testable: true,
		docsUrl: 'https://help.shopify.com/en/manual/apps/app-types/custom-apps',
		iconSvg: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
		exampleSnippet: "const store = so.connection('__NAME__');\nconst orders = await store.fetch({ endpoint: 'orders.list', params: { status: 'any', limit: 50 } });",
	},
};

export const SHOPIFY_API_VERSION = '2024-01';
