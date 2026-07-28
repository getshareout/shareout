import type { ProviderConfig } from '../../types';

// Facebook (Meta) Marketing API. Connected via a pasted long-lived access token
// (token-shim) plus an ad account id — no OAuth dance yet (that needs Meta App
// Review for ads_read). Server-side only: the token is a secret.
export const FACEBOOK_ADS_CONFIG: ProviderConfig = {
	id: 'facebook-ads',
	name: 'Facebook Ads',
	version: 'v21.0',

	execution: {
		defaultMode: 'proxy',
		directSupported: false,
		proxyRequired: true,
		corsAllowed: [],
	},

	auth: {
		type: 'bearer',
		refreshable: false,
	},

	rateLimit: {
		requestsPerMinute: 200,
		quotaTracking: 'per-connection',
	},

	cache: {
		defaultTtlSeconds: 300,
		maxTtlSeconds: 3600,
		persistable: true,
		userRefreshable: true,
	},

	api: {
		baseUrl: 'https://graph.facebook.com/v21.0',
	},

	pagination: {
		type: 'cursor',
		defaultLimit: 100,
		maxLimit: 500,
		cursorField: 'after',
	},

	display: {
		label: 'Facebook Ads',
		category: 'ads',
		tagline: 'Campaign spend, reach & ROAS',
		color: '#1877F2',
		connectMethod: 'token',
		testable: true,
		docsUrl: 'https://developers.facebook.com/docs/marketing-api/overview/authorization',
		iconSvg: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M14 8h-1.5a1.5 1.5 0 0 0-1.5 1.5V12H9v2.5h2V21"/><line x1="11" y1="12" x2="14" y2="12"/>',
		exampleSnippet: "const meta = so.connection('__NAME__');\nconst { data } = await meta.query({\n  endpoint: 'insights',\n  params: { date_preset: 'last_30d', level: 'campaign', fields: 'campaign_name,spend,impressions,purchase_roas' },\n});",
	},
};

export const FACEBOOK_ADS_API_BASE = 'https://graph.facebook.com/v21.0';
