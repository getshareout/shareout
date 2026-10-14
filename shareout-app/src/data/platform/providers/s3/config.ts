import type { ProviderConfig } from '../../types';
import { PROXY_ONLY } from '../static-credentials-provider';

// Amazon S3 (and S3-compatible stores via a custom endpoint), read-only:
// list a bucket, read CSV/JSON/text objects, or mint a short-lived download URL.
export const S3_CONFIG: ProviderConfig = {
	id: 's3',
	name: 'Amazon S3',
	version: '2006-03-01',
	...PROXY_ONLY,
	rateLimit: { requestsPerMinute: 300, requestsPerSecond: 20, quotaTracking: 'per-connection' },
	cache: { defaultTtlSeconds: 60, maxTtlSeconds: 3600, persistable: true, userRefreshable: true },
	api: { baseUrl: 'https://s3.amazonaws.com' },
	display: {
		label: 'Amazon S3',
		category: 'storage',
		tagline: 'Read CSV, JSON & files from a bucket',
		color: '#3F8624',
		connectMethod: 'token',
		testable: true,
		docsUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
		iconSvg: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
		exampleSnippet: "const s3 = sdk.platform.provider('s3');\nconst { data } = await s3.execute('objects.get', {\n  connectionId,\n  params: { queryParams: { key: 'exports/orders.csv' } },\n});\nconsole.log(data.rows);",
	},
};
