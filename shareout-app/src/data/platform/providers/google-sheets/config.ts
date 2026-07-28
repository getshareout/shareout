import type { ProviderConfig } from '../../types';

export const GOOGLE_SHEETS_CONFIG: ProviderConfig = {
	id: 'google-sheets',
	name: 'Google Sheets',
	version: 'v4',

	execution: {
		defaultMode: 'direct',
		directSupported: true,
		proxyRequired: false,
		corsAllowed: [],
	},

	auth: {
		type: 'oauth2',
		oauth: {
			authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
			tokenUrl: 'https://oauth2.googleapis.com/token',
			revokeUrl: 'https://oauth2.googleapis.com/revoke',
			pkceRequired: false,
			scopes: ['https://www.googleapis.com/auth/spreadsheets'],
			clientIdEnvVar: 'GOOGLE_CLIENT_ID',
			clientSecretEnvVar: 'GOOGLE_CLIENT_SECRET',
		},
		refreshable: true,
		expiresInSeconds: 3600,
	},

	rateLimit: {
		requestsPerMinute: 300,
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
		baseUrl: 'https://sheets.googleapis.com/v4/spreadsheets',
	},

	pagination: {
		type: 'none',
		defaultLimit: 1000,
		maxLimit: 10000,
	},

	display: {
		label: 'Google Sheets',
		category: 'productivity',
		tagline: 'Read & sync spreadsheet data',
		color: '#0F9D58',
		connectMethod: 'oauth',
		iconSvg: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>',
	},
};

export const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
