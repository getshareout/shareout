import type { ProviderResponse, VerifyResult } from '../base-provider';
import type { ProviderConfig, ProviderEndpoint, ExecutionContext, RequestParams, DecryptedCredentials, Env } from '../../types';
import { PROXY_ONLY, StaticCredentialsProvider } from '../static-credentials-provider';
import { awsClient, awsErrorMessage, awsKeysFrom, type AwsKeys, type SqlResult } from '../aws/client';
import { SQL_QUERY, maxRowsFrom, sqlFrom } from '../sql-endpoint';
import { registerProvider } from '../../registry';

// Amazon Aurora (PostgreSQL or MySQL) through the RDS Data API — HTTPS + SigV4, so
// it works from a Worker and needs no public endpoint. Database login lives in a
// Secrets Manager secret; the IAM key only needs rds-data:ExecuteStatement and
// secretsmanager:GetSecretValue on that secret. Plain (non-Aurora) RDS has no Data
// API, and a Worker can't verify the private RDS CA over a raw socket, so it's out.
export const AURORA_CONFIG: ProviderConfig = {
	id: 'aurora',
	name: 'Amazon Aurora',
	version: '2018-08-01',
	...PROXY_ONLY,
	rateLimit: { requestsPerMinute: 120, requestsPerSecond: 10, quotaTracking: 'per-connection' },
	cache: { defaultTtlSeconds: 300, maxTtlSeconds: 3600, persistable: true, userRefreshable: true },
	api: { baseUrl: 'https://rds-data.us-east-1.amazonaws.com' },
	display: {
		label: 'Amazon Aurora',
		category: 'warehouse',
		tagline: 'Aurora PostgreSQL or MySQL via the RDS Data API',
		color: '#527FFF',
		connectMethod: 'token',
		testable: true,
		docsUrl: 'https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html',
		iconSvg: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M9 13l2 2 4-4"/>',
		exampleSnippet: "const { data } = await sdk.platform.execute('aurora', 'sql.query', {\n  connectionId,\n  params: { body: { sql: 'select plan, count(*) from accounts group by 1' } },\n});\nconsole.log(data.rows);",
	},
};

export interface AuroraConnectionConfig {
	/** Cluster ARN: arn:aws:rds:<region>:<account>:cluster:<name> */
	resource_arn?: string;
	/** Secrets Manager ARN with the database username/password. */
	secret_arn?: string;
	database?: string;
	schema?: string;
}

const CLUSTER_ARN = /^arn:aws[a-z-]*:rds:([a-z0-9-]+):\d{12}:cluster:[A-Za-z0-9-]+$/;
const SECRET_ARN = /^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/;

export function auroraConfigError(cfg: AuroraConnectionConfig): string | null {
	if (!cfg.resource_arn || !CLUSTER_ARN.test(cfg.resource_arn)) return 'Cluster ARN is required (arn:aws:rds:<region>:<account>:cluster:<name>)';
	if (!cfg.secret_arn || !SECRET_ARN.test(cfg.secret_arn)) return 'Secrets Manager secret ARN is required';
	if (!cfg.database) return 'Database is required';
	return null;
}

function regionOf(cfg: AuroraConnectionConfig): string {
	return cfg.resource_arn!.match(CLUSTER_ARN)![1];
}

class AuroraProvider extends StaticCredentialsProvider {
	readonly config = AURORA_CONFIG;
	readonly endpoints = new Map<string, ProviderEndpoint>([[SQL_QUERY.id, SQL_QUERY]]);

	async runSql(cfg: AuroraConnectionConfig, keys: AwsKeys, sql: string, maxRows: number): Promise<SqlResult> {
		const region = regionOf(cfg);
		const res = await awsClient(keys, 'rds-data', region).fetch(`https://rds-data.${region}.amazonaws.com/Execute`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				resourceArn: cfg.resource_arn,
				secretArn: cfg.secret_arn,
				database: cfg.database,
				...(cfg.schema ? { schema: cfg.schema } : {}),
				sql,
				includeResultMetadata: true,
				formatRecordsAs: 'JSON',
			}),
		});
		if (!res.ok) throw new Error(await awsErrorMessage(res));
		const out = (await res.json()) as { formattedRecords?: string; columnMetadata?: { label?: string; name?: string }[] };
		const rows = out.formattedRecords ? (JSON.parse(out.formattedRecords) as Record<string, unknown>[]) : [];
		const columns = (out.columnMetadata || []).map((c, i) => c.label || c.name || String(i));
		return { columns, rows: rows.slice(0, maxRows) };
	}

	async verifyConnection(_env: Env, config: Record<string, unknown>, credentials: DecryptedCredentials): Promise<VerifyResult> {
		const cfg = config as AuroraConnectionConfig;
		const bad = auroraConfigError(cfg);
		if (bad) return { ok: false, message: bad };
		const keys = awsKeysFrom(credentials);
		if (!keys) return { ok: false, message: 'Access key ID and secret access key are required' };
		try {
			await this.runSql(cfg, keys, 'select 1 as ok', 1);
			return { ok: true, message: `Connected to ${cfg.database}` };
		} catch (err) {
			return { ok: false, message: err instanceof Error ? err.message.slice(0, 300) : 'Connection test failed' };
		}
	}

	async executeRequest<T = unknown>(ctx: ExecutionContext, _endpoint: ProviderEndpoint, params: RequestParams): Promise<ProviderResponse<T>> {
		const cfg = ctx.connectionConfig.config as AuroraConnectionConfig;
		const bad = auroraConfigError(cfg);
		if (bad) return this.fail('AURORA_CONFIG', bad);
		const keys = awsKeysFrom(ctx.credentials);
		if (!keys) return this.fail('MISSING_CREDENTIALS', 'No AWS access key stored for this connection');
		const sql = sqlFrom(params);
		if (!sql) return this.fail('MISSING_SQL', 'body.sql is required');
		try {
			const data = await this.runSql(cfg, keys, sql, maxRowsFrom(params));
			return { success: true, status: 200, data: data as T };
		} catch (err) {
			return this.fail('AURORA_QUERY_FAILED', err instanceof Error ? err.message : 'Query failed');
		}
	}
}

const auroraProvider = new AuroraProvider();
registerProvider(auroraProvider);

export { auroraProvider };
