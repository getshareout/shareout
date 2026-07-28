import type { ProviderConfig } from '../../types';

export const GOOGLE_ANALYTICS_CONFIG: ProviderConfig = {
	id: 'google-analytics',
	name: 'Google Analytics',
	version: 'v1beta',

	execution: {
		defaultMode: 'proxy',
		directSupported: false,
		proxyRequired: true,
		corsAllowed: [],
	},

	auth: {
		// BYO service-account: the customer adds a GCP service account to their GA4
		// property and pastes its key. We mint a token server-side per query.
		type: 'custom',
		scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
		refreshable: false,
	},

	rateLimit: {
		requestsPerMinute: 600,
		requestsPerSecond: 10,
		quotaTracking: 'per-artifact',
	},

	cache: {
		defaultTtlSeconds: 300,
		maxTtlSeconds: 3600,
		persistable: true,
		userRefreshable: true,
	},

	api: {
		baseUrl: 'https://analyticsdata.googleapis.com/v1beta',
	},

	pagination: {
		type: 'offset',
		defaultLimit: 10000,
		maxLimit: 100000,
	},

	display: {
		label: 'Google Analytics',
		category: 'analytics',
		tagline: 'GA4 traffic, events & conversions',
		color: '#E8710A',
		connectMethod: 'service_account',
		testable: true,
		docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart-client-libraries#service-account',
		iconSvg: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
		exampleSnippet: "const ga = so.connection('__NAME__');\nconst { data } = await ga.query({\n  endpoint: 'reports.run',\n  body: {\n    dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],\n    dimensions: [{ name: 'date' }],\n    metrics: [{ name: 'activeUsers' }],\n  },\n});",
	},
};

export const GA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
