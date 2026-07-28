import type { ProviderConfig } from '../../types';

export const BIGQUERY_CONFIG: ProviderConfig = {
	id: 'bigquery',
	name: 'Google BigQuery',
	version: 'v2',

	execution: {
		defaultMode: 'proxy',
		directSupported: false,
		proxyRequired: true,
		corsAllowed: [],
	},

	auth: {
		type: 'oauth2',
		oauth: {
			authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
			tokenUrl: 'https://oauth2.googleapis.com/token',
			revokeUrl: 'https://oauth2.googleapis.com/revoke',
			pkceRequired: false,
			scopes: ['https://www.googleapis.com/auth/bigquery'],
			clientIdEnvVar: 'GOOGLE_CLIENT_ID',
			clientSecretEnvVar: 'GOOGLE_CLIENT_SECRET',
		},
		refreshable: true,
		expiresInSeconds: 3600,
	},

	rateLimit: {
		requestsPerMinute: 100,
		requestsPerSecond: 5,
		quotaTracking: 'per-connection',
	},

	cache: {
		defaultTtlSeconds: 300,
		maxTtlSeconds: 3600,
		persistable: true,
		userRefreshable: true,
	},

	api: {
		baseUrl: 'https://bigquery.googleapis.com/bigquery/v2',
	},

	pagination: {
		type: 'cursor',
		defaultLimit: 1000,
		maxLimit: 100000,
		cursorField: 'pageToken',
	},

	display: {
		label: 'BigQuery',
		category: 'warehouse',
		tagline: 'Query Google Cloud datasets',
		color: '#4285F4',
		connectMethod: 'service_account',
		iconSvg: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
	},
};

export const BIGQUERY_API_BASE = 'https://bigquery.googleapis.com/bigquery/v2';
