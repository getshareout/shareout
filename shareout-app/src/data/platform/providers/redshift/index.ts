import type { ProviderResponse, VerifyResult } from '../base-provider';
import type { ProviderConfig, ProviderEndpoint, ExecutionContext, RequestParams, DecryptedCredentials, Env } from '../../types';
import { PROXY_ONLY, StaticCredentialsProvider } from '../static-credentials-provider';
import { awsClient, awsErrorMessage, awsKeysFrom, sleep, validRegion, type AwsKeys, type SqlResult } from '../aws/client';
import { SQL_QUERY, maxRowsFrom, sqlFrom, timeoutFrom } from '../sql-endpoint';
import { registerProvider } from '../../registry';

// Amazon Redshift through the Redshift Data API (HTTPS + SigV4). No TCP socket and
// no public endpoint needed: it reaches private clusters and Serverless workgroups
// through AWS, authenticated by an IAM key. Statements run async; we submit, poll
// DescribeStatement, then page GetStatementResult.
export const REDSHIFT_CONFIG: ProviderConfig = {
	id: 'redshift',
	name: 'Amazon Redshift',
	version: '2019-12-20',
	...PROXY_ONLY,
	rateLimit: { requestsPerMinute: 60, requestsPerSecond: 5, quotaTracking: 'per-connection' },
	cache: { defaultTtlSeconds: 300, maxTtlSeconds: 3600, persistable: true, userRefreshable: true },
	api: { baseUrl: 'https://redshift-data.us-east-1.amazonaws.com' },
	display: {
		label: 'Amazon Redshift',
		category: 'warehouse',
		tagline: 'Query a Redshift cluster or Serverless workgroup',
		color: '#8C4FFF',
		connectMethod: 'token',
		testable: true,
		docsUrl: 'https://docs.aws.amazon.com/redshift/latest/mgmt/data-api-access.html',
		iconSvg: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5"/><line x1="12" y1="12" x2="12" y2="22"/>',
		exampleSnippet: "const { data } = await sdk.platform.execute('redshift', 'sql.query', {\n  connectionId,\n  params: { body: { sql: 'select region, sum(revenue) from sales group by 1' } },\n});\nconsole.log(data.rows);",
	},
};

export interface RedshiftConnectionConfig {
	region?: string;
	database?: string;
	/** Provisioned cluster id — set this OR workgroup_name. */
	cluster_identifier?: string;
	/** Redshift Serverless workgroup — set this OR cluster_identifier. */
	workgroup_name?: string;
	/** Provisioned only: database user to get temporary credentials for. */
	db_user?: string;
	/** Secrets Manager ARN holding the database username/password (either target). */
	secret_arn?: string;
}

interface Field { stringValue?: string; longValue?: number; doubleValue?: number; booleanValue?: boolean; isNull?: boolean; blobValue?: string }
interface Column { name?: string; label?: string; typeName?: string }

const NUMERIC_TYPES = /^(int|int2|int4|int8|smallint|integer|bigint|numeric|decimal|float|float4|float8|real|double)/i;
const DEFAULT_TIMEOUT_MS = 60_000;

export function redshiftConfigError(cfg: RedshiftConnectionConfig): string | null {
	if (!validRegion(cfg.region)) return 'A valid AWS region is required (e.g. us-east-1)';
	if (!cfg.database) return 'Database is required';
	if (!cfg.cluster_identifier === !cfg.workgroup_name) return 'Set either a cluster identifier or a Serverless workgroup name';
	if (cfg.cluster_identifier && !cfg.db_user && !cfg.secret_arn) return 'A provisioned cluster needs a database user or a Secrets Manager ARN';
	return null;
}

/** Data API records → row objects keyed by column name, numerics coerced. */
export function parseRedshiftRecords(columns: Column[], records: Field[][]): Record<string, unknown>[] {
	return records.map((rec) => {
		const row: Record<string, unknown> = {};
		columns.forEach((c, i) => {
			const f = rec[i] || {};
			const name = c.label || c.name || String(i);
			if (f.isNull) row[name] = null;
			else if (f.longValue !== undefined) row[name] = f.longValue;
			else if (f.doubleValue !== undefined) row[name] = f.doubleValue;
			else if (f.booleanValue !== undefined) row[name] = f.booleanValue;
			else if (f.stringValue !== undefined) {
				const n = NUMERIC_TYPES.test(c.typeName || '') ? Number(f.stringValue) : NaN;
				row[name] = Number.isFinite(n) ? n : f.stringValue;
			} else row[name] = f.blobValue ?? null;
		});
		return row;
	});
}

class RedshiftProvider extends StaticCredentialsProvider {
	readonly config = REDSHIFT_CONFIG;
	readonly endpoints = new Map<string, ProviderEndpoint>([[SQL_QUERY.id, SQL_QUERY]]);

	private call(keys: AwsKeys, region: string, action: string, body: Record<string, unknown>) {
		return awsClient(keys, 'redshift-data', region).fetch(`https://redshift-data.${region}.amazonaws.com/`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `RedshiftData.${action}` },
			body: JSON.stringify(body),
		});
	}

	async runSql(cfg: RedshiftConnectionConfig, keys: AwsKeys, sql: string, maxRows: number, timeoutMs: number): Promise<SqlResult> {
		const region = cfg.region!;
		const exec = await this.call(keys, region, 'ExecuteStatement', {
			Sql: sql,
			Database: cfg.database,
			...(cfg.cluster_identifier ? { ClusterIdentifier: cfg.cluster_identifier } : { WorkgroupName: cfg.workgroup_name }),
			...(cfg.secret_arn ? { SecretArn: cfg.secret_arn } : cfg.db_user ? { DbUser: cfg.db_user } : {}),
		});
		if (!exec.ok) throw new Error(await awsErrorMessage(exec));
		const { Id } = (await exec.json()) as { Id: string };

		const deadline = Date.now() + timeoutMs;
		let wait = 250;
		let status: { Status?: string; Error?: string; HasResultSet?: boolean };
		for (;;) {
			await sleep(wait);
			wait = Math.min(wait * 2, 2000);
			const d = await this.call(keys, region, 'DescribeStatement', { Id });
			if (!d.ok) throw new Error(await awsErrorMessage(d));
			status = await d.json();
			if (status.Status === 'FINISHED') break;
			if (status.Status === 'FAILED' || status.Status === 'ABORTED') throw new Error(status.Error || `Statement ${status.Status.toLowerCase()}`);
			if (Date.now() > deadline) {
				await this.call(keys, region, 'CancelStatement', { Id }).catch(() => null);
				throw new Error(`Query did not finish within ${Math.round(timeoutMs / 1000)}s`);
			}
		}
		if (!status.HasResultSet) return { columns: [], rows: [] };

		let columns: Column[] = [];
		const rows: Record<string, unknown>[] = [];
		let NextToken: string | undefined;
		do {
			const r = await this.call(keys, region, 'GetStatementResult', { Id, ...(NextToken ? { NextToken } : {}) });
			if (!r.ok) throw new Error(await awsErrorMessage(r));
			const page = (await r.json()) as { ColumnMetadata?: Column[]; Records?: Field[][]; NextToken?: string };
			if (page.ColumnMetadata?.length) columns = page.ColumnMetadata;
			rows.push(...parseRedshiftRecords(columns, page.Records || []));
			NextToken = page.NextToken;
		} while (NextToken && rows.length < maxRows);
		return { columns: columns.map((c, i) => c.label || c.name || String(i)), rows: rows.slice(0, maxRows) };
	}

	async verifyConnection(_env: Env, config: Record<string, unknown>, credentials: DecryptedCredentials): Promise<VerifyResult> {
		const cfg = config as RedshiftConnectionConfig;
		const bad = redshiftConfigError(cfg);
		if (bad) return { ok: false, message: bad };
		const keys = awsKeysFrom(credentials);
		if (!keys) return { ok: false, message: 'Access key ID and secret access key are required' };
		try {
			await this.runSql(cfg, keys, 'select 1 as ok', 1, 30_000);
			return { ok: true, message: `Connected to ${cfg.database}` };
		} catch (err) {
			return { ok: false, message: err instanceof Error ? err.message.slice(0, 300) : 'Connection test failed' };
		}
	}

	async executeRequest<T = unknown>(ctx: ExecutionContext, _endpoint: ProviderEndpoint, params: RequestParams): Promise<ProviderResponse<T>> {
		const cfg = ctx.connectionConfig.config as RedshiftConnectionConfig;
		const bad = redshiftConfigError(cfg);
		if (bad) return this.fail('REDSHIFT_CONFIG', bad);
		const keys = awsKeysFrom(ctx.credentials);
		if (!keys) return this.fail('MISSING_CREDENTIALS', 'No AWS access key stored for this connection');
		const sql = sqlFrom(params);
		if (!sql) return this.fail('MISSING_SQL', 'body.sql is required');
		try {
			const data = await this.runSql(cfg, keys, sql, maxRowsFrom(params), timeoutFrom(params, DEFAULT_TIMEOUT_MS));
			return { success: true, status: 200, data: data as T };
		} catch (err) {
			return this.fail('REDSHIFT_QUERY_FAILED', err instanceof Error ? err.message : 'Query failed');
		}
	}
}

const redshiftProvider = new RedshiftProvider();
registerProvider(redshiftProvider);

export { redshiftProvider };
