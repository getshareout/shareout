import type { ProviderConfig } from '../../types';

// Bot scopes requested at install. Delivery: chat:write(.public) to post to
// channels (incl. ones the bot hasn't joined), files:write for snapshot/PDF
// uploads, im:write to open DM channels. Identity: users:read(.email) to map a
// ShareOut account to its Slack user. Future surface (provisioned now to avoid
// re-auth): chat:write.customize for per-message branding, links:read/write to
// unfurl shareout.site links into rich previews, reactions:write to ack.
export const SLACK_SCOPES = [
	'chat:write',
	'chat:write.public',
	'chat:write.customize',
	'channels:read',
	'groups:read',
	'files:write',
	'im:write',
	'users:read',
	'users:read.email',
	'links:read',
	'links:write',
	'reactions:write',
	'team:read',
];

export const SLACK_CONFIG: ProviderConfig = {
	id: 'slack',
	name: 'Slack',
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
			authorizationUrl: 'https://slack.com/oauth/v2/authorize',
			tokenUrl: 'https://slack.com/api/oauth.v2.access',
			revokeUrl: undefined,
			pkceRequired: false,
			scopes: SLACK_SCOPES,
			clientIdEnvVar: 'SLACK_CLIENT_ID',
			clientSecretEnvVar: 'SLACK_CLIENT_SECRET',
		},
		refreshable: false,
		expiresInSeconds: undefined,
	},

	rateLimit: {
		requestsPerMinute: 60,
		requestsPerSecond: 1,
		quotaTracking: 'per-connection',
	},

	cache: {
		defaultTtlSeconds: 300,
		maxTtlSeconds: 3600,
		persistable: true,
		userRefreshable: true,
	},

	api: {
		baseUrl: 'https://slack.com/api',
	},

	pagination: {
		type: 'cursor',
		defaultLimit: 100,
		maxLimit: 200,
		cursorField: 'cursor',
	},

	display: {
		label: 'Slack',
		category: 'messaging',
		tagline: 'Post reports & alerts to channels',
		color: '#4A154B',
		connectMethod: 'oauth',
		iconSvg: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
	},
};
