import type { ProviderConfig } from '../../types';
import { PROXY_ONLY } from '../static-credentials-provider';

// Humand (employee app / HR platform) over its Public API, read-only. Auth is a
// per-community API key sent as `Authorization: Basic <key>`.
// Spec: https://api-prod.humand.co/public/api/v1/api-docs/
export const HUMAND_API = 'https://api-prod.humand.co/public/api/v1';

export const HUMAND_CONFIG: ProviderConfig = {
	id: 'humand',
	name: 'Humand',
	version: 'v1',
	...PROXY_ONLY,
	auth: { type: 'api_key', apiKey: { headerName: 'Authorization', prefix: 'Basic ' }, refreshable: false },
	pagination: { type: 'page', defaultLimit: 10, maxLimit: 500 },
	// Humand's policy is 100 requests per 60 s per key (RateLimit-Policy: 100;w=60).
	rateLimit: { requestsPerMinute: 100, quotaTracking: 'per-connection' },
	cache: { defaultTtlSeconds: 300, maxTtlSeconds: 3600, persistable: true, userRefreshable: true },
	api: { baseUrl: HUMAND_API },
	display: {
		label: 'Humand',
		category: 'people',
		tagline: 'Employees, departments, time off & attendance (read-only)',
		color: '#4F46E5',
		connectMethod: 'token',
		testable: true,
		docsUrl: 'https://api-prod.humand.co/public/api/v1/api-docs/',
		iconSvg: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/>',
		exampleSnippet: "const sdk = await ShareOut.create();\nconst conn = (await sdk.platform.connections()).find((c) => c.name === '__NAME__');\nconst { data } = await sdk.platform.execute('humand', 'users.list', {\n  connectionId: conn.id,\n  params: { queryParams: { page: 1, limit: 100 } },\n});\nconsole.log(data.count, data.users);",
	},
};
