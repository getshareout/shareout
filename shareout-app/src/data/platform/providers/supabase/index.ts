import type { ProviderResponse, VerifyResult } from '../base-provider';
import type { ProviderConfig, ProviderEndpoint, ExecutionContext, RequestParams, DecryptedCredentials, Env } from '../../types';
import { PROXY_ONLY, StaticCredentialsProvider } from '../static-credentials-provider';
import { awsErrorMessage, type SqlResult } from '../aws/client';
import { SQL_QUERY, maxRowsFrom, sqlFrom } from '../sql-endpoint';
import { registerProvider } from '../../registry';

// Supabase over its Management API — HTTPS only. A Worker can't open a TLS Postgres
// socket to Supabase (its pooler presents a private "Supabase Root 2021 CA" the
// runtime won't trust), but /database/query/read-only runs SQL as Supabase's
// built-in supabase_read_only_user, so the connector is read-only by construction.
export const SUPABASE_API = 'https://api.supabase.com/v1';

export const SUPABASE_CONFIG: ProviderConfig = {
	id: 'supabase',
	name: 'Supabase',
	version: 'v1',
	...PROXY_ONLY,
	rateLimit: { requestsPerMinute: 60, requestsPerSecond: 5, quotaTracking: 'per-connection' },
	cache: { defaultTtlSeconds: 300, maxTtlSeconds: 3600, persistable: true, userRefreshable: true },
	api: { baseUrl: SUPABASE_API },
	display: {
		label: 'Supabase',
		category: 'warehouse',
		tagline: 'Query your Supabase Postgres (read-only)',
		color: '#3ECF8E',
		connectMethod: 'token',
		testable: true,
		docsUrl: 'https://supabase.com/dashboard/account/tokens',
		iconSvg: '<path d="M13 2 4 14h8l-1 8 9-12h-8z"/>',
		exampleSnippet: "const { data } = await sdk.platform.execute('supabase', 'sql.query', {\n  connectionId,\n  params: { body: { sql: 'select status, count(*) from orders group by 1' } },\n});\nconsole.log(data.rows);",
	},
};

const REF_RE = /^[a-z0-9]{20}$/;

/** Accept a project ref, project URL, dashboard URL or connection string → ref. */
export function parseSupabaseRef(input: unknown): string | null {
	const s = typeof input === 'string' ? input.trim() : '';
	if (REF_RE.test(s)) return s;
	const m = s.match(/(?:^|\/\/|\/project\/|postgres\.|db\.)([a-z0-9]{20})(?:[./:@]|$)/);
	return m ? m[1] : null;
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
	return rows.length ? Object.keys(rows[0]) : [];
}

class SupabaseProvider extends StaticCredentialsProvider {
	readonly config = SUPABASE_CONFIG;
	readonly endpoints = new Map<string, ProviderEndpoint>([[SQL_QUERY.id, SQL_QUERY]]);

	private async run(ref: string, token: string, sql: string): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; status: number; message: string }> {
		const res = await fetch(`${SUPABASE_API}/projects/${ref}/database/query/read-only`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: sql }),
		});
		if (!res.ok) {
			const message = res.status === 401 ? 'Supabase rejected the access token'
				: res.status === 403 ? 'This token cannot read that project'
				: res.status === 404 ? 'No Supabase project with that ref'
				: await awsErrorMessage(res);
			return { ok: false, status: res.status, message };
		}
		const body = (await res.json().catch(() => [])) as unknown;
		const rows = Array.isArray(body) ? body : Array.isArray((body as { result?: unknown })?.result) ? (body as { result: unknown[] }).result : [];
		return { ok: true, rows: rows as Record<string, unknown>[] };
	}

	async verifyConnection(_env: Env, config: Record<string, unknown>, credentials: DecryptedCredentials): Promise<VerifyResult> {
		const ref = parseSupabaseRef(config.project_ref);
		if (!ref) return { ok: false, message: 'Project ref not recognized (20 characters, from your project URL)' };
		if (!credentials.access_token) return { ok: false, message: 'Access token is required' };
		const r = await this.run(ref, credentials.access_token, 'select 1 as ok');
		return r.ok ? { ok: true, message: 'Connected (read-only)' } : { ok: false, message: r.message };
	}

	async executeRequest<T = unknown>(ctx: ExecutionContext, _endpoint: ProviderEndpoint, params: RequestParams): Promise<ProviderResponse<T>> {
		const ref = parseSupabaseRef(ctx.connectionConfig.config.project_ref);
		if (!ref) return this.fail('SUPABASE_CONFIG', 'project_ref is missing or invalid on this connection');
		if (!ctx.credentials.access_token) return this.fail('MISSING_CREDENTIALS', 'No Supabase access token stored for this connection');
		const sql = sqlFrom(params);
		if (!sql) return this.fail('MISSING_SQL', 'body.sql is required');
		const r = await this.run(ref, ctx.credentials.access_token, sql);
		if (!r.ok) return this.fail(`SUPABASE_ERROR_${r.status}`, r.message, r.status);
		const rows = r.rows.slice(0, maxRowsFrom(params));
		const data: SqlResult = { columns: columnsOf(rows), rows };
		return { success: true, status: 200, data: data as T };
	}
}

const supabaseProvider = new SupabaseProvider();
registerProvider(supabaseProvider);

export { supabaseProvider };
