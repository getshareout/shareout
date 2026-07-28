import type { ProviderConfig } from '../../types';

// Google Ads API. Connected via a token-shim: the user supplies an OAuth client
// id/secret + refresh token (authorized_user) plus a Google Ads developer token
// and customer id. We mint access tokens server-side per query. No interactive
// OAuth yet (Google Ads needs an approved developer token regardless).
export const GOOGLE_ADS_CONFIG: ProviderConfig = {
	id: 'google-ads',
	name: 'Google Ads',
	version: 'v17',

	execution: {
		defaultMode: 'proxy',
		directSupported: false,
		proxyRequired: true,
		corsAllowed: [],
	},

	auth: {
		type: 'custom',
		refreshable: false,
	},

	rateLimit: {
		requestsPerMinute: 60,
		quotaTracking: 'per-connection',
	},

	cache: {
		defaultTtlSeconds: 300,
		maxTtlSeconds: 3600,
		persistable: true,
		userRefreshable: true,
	},

	api: {
		baseUrl: 'https://googleads.googleapis.com/v17',
	},

	pagination: {
		type: 'none',
		defaultLimit: 10000,
		maxLimit: 100000,
	},

	display: {
		label: 'Google Ads',
		category: 'ads',
		tagline: 'Campaign spend, clicks & conversions',
		color: '#4285F4',
		connectMethod: 'token',
		testable: true,
		docsUrl: 'https://developers.google.com/google-ads/api/docs/get-started/dev-token',
		iconSvg: '<path d="M3 17 10 5l4 7"/><circle cx="18" cy="17" r="3"/><line x1="3" y1="17" x2="14" y2="17"/>',
		exampleSnippet: "const ads = so.connection('__NAME__');\nconst { data } = await ads.query({\n  endpoint: 'search',\n  body: { query: 'SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date DURING LAST_30_DAYS' },\n});",
	},
};

export const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v17';
