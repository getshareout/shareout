import type { ProviderConfig } from '../../types';

// Snowflake is reached server-side via its SQL API v2 with key-pair JWT auth.
// There is no browser/CORS path, so it runs proxy-only like BigQuery.
export const SNOWFLAKE_CONFIG: ProviderConfig = {
	id: 'snowflake',
	name: 'Snowflake',
	version: 'v2',

	execution: {
		defaultMode: 'proxy',
		directSupported: false,
		proxyRequired: true,
		corsAllowed: [],
	},

	auth: {
		// Key-pair JWT minted per request from the stored private key.
		type: 'custom',
		refreshable: false,
		expiresInSeconds: 3540,
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
		// Host is per-connection ({account}.snowflakecomputing.com); this is a
		// placeholder so tooling that reads baseUrl has a value.
		baseUrl: 'https://snowflakecomputing.com',
		version: 'v2',
	},

	pagination: {
		type: 'cursor',
		defaultLimit: 1000,
		maxLimit: 1000000,
		cursorField: 'partition',
	},

	display: {
		label: 'Snowflake',
		category: 'warehouse',
		tagline: 'Query your Snowflake warehouse',
		color: '#29B5E8',
		connectMethod: 'key_pair',
		iconSvg: '<line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
	},
};
