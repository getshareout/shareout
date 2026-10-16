// @vitest-environment node
// Row-level scoping for Data Platform SQL, run end to end against a real SQL engine:
// the provider call is answered by D1, so each test checks the rows a viewer gets back,
// not the text of the query.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlatformRequest, PlatformEngine, PlatformRateLimiter } from '../../../../src/data/platform';
import { supabaseProvider } from '../../../../src/data/platform/providers/supabase';
import { sqlFrom } from '../../../../src/data/platform/providers/sql-endpoint';
import { parseAccessPolicy, validateAccessPolicy, type AccessPolicy, type ViewerScope } from '../../../../src/data/access-policy';
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';
import { BASE_URL, publicArtifactEnv, makeDataContext, encryptTestCredentials } from './helpers';

const warehouse = (env as unknown as Env).DB;
const TABLE = 'vs_scope_sales';
const CONN = 'conn_wh';

const POLICY: AccessPolicy = {
  version: 1,
  field: 'company_id',
  default: 'deny',
  rules: [
    { match: { domain: 'acme.example' }, values: [1] },
    { match: { domain: 'globex.example' }, values: [2] },
  ],
  queries: {
    by_placeholder: {
      connection: CONN, provider: 'supabase', endpoint: 'sql.query',
      params: { body: { sql: `SELECT company_id, revenue FROM ${TABLE} WHERE company_id IN (:viewer_scope) ORDER BY company_id` } },
    },
    by_wrap: {
      connection: CONN, provider: 'supabase', endpoint: 'sql.query',
      params: { body: { sql: `SELECT company_id, revenue FROM ${TABLE} ORDER BY company_id;` } },
    },
    commented_placeholder: {
      connection: CONN, provider: 'supabase', endpoint: 'sql.query',
      params: { body: { sql: `SELECT company_id, revenue FROM ${TABLE} -- WHERE company_id IN (:viewer_scope)` } },
    },
    totals: {
      connection: CONN, provider: 'supabase', endpoint: 'sql.query',
      params: { body: { sql: `SELECT SUM(revenue) AS total FROM ${TABLE} WHERE company_id IN (:viewer_scope)` } },
    },
  },
};

const ACME: ViewerScope = { field: 'company_id', values: [1] };
const GLOBEX: ViewerScope = { field: 'company_id', values: [2] };
const NOBODY: ViewerScope = { field: 'company_id', values: [] };

const providerSql: string[] = [];
let seq = 0;

beforeAll(async () => {
  await warehouse.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (company_id INTEGER, revenue INTEGER)`);
  await warehouse.exec(`DELETE FROM ${TABLE}`);
  await warehouse.exec(`INSERT INTO ${TABLE} VALUES (1, 10), (2, 20), (3, 30)`);
});

beforeEach(() => {
  providerSql.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(PlatformRateLimiter.prototype, 'checkAndConsume').mockReturnValue({ allowed: true, remaining: 1, limit: 1, resetAt: 0 });
  vi.spyOn(supabaseProvider, 'executeRequest').mockImplementation(async (_ctx, _endpoint, params) => {
    const sql = sqlFrom(params);
    providerSql.push(sql);
    try {
      const r = await warehouse.prepare(sql).all();
      return { success: true, data: { rows: r.results } as never };
    } catch (err) {
      return { success: false, status: 400, error: { code: 'SQL_ERROR', message: String(err) } };
    }
  });
});

async function platformEnv(): Promise<Env> {
  const { encrypted, iv } = await encryptTestCredentials({ access_token: 'sbp_test' });
  return publicArtifactEnv({}, {
    first: (sql, bindings) => (sql.includes("scope_type = 'artifact'")
      ? {
          id: bindings[1], scope_type: 'artifact', scope_id: bindings[0], name: 'WH', provider: 'supabase',
          config: JSON.stringify({ project_ref: 'abcdefghijklmnopqrst' }),
          encrypted_credentials: encrypted, iv, preferred_mode: 'proxy', created_at: '', updated_at: '',
        }
      : null),
  });
}

/** A viewer request through the HTTP handler. */
async function viewerRequest(scope: ViewerScope | null, body: Record<string, unknown>, policy: unknown = POLICY) {
  const e = await platformEnv();
  const base = makeDataContext(e);
  const ctx: DataContext = {
    ...base,
    artifactId: `art_vs_${++seq}`,
    artifact: { ...base.artifact, access_policy: policy === null ? null : JSON.stringify(policy) },
    workspaceId: 'ws_1',
    viewerScope: scope,
  };
  const res = await handlePlatformRequest(
    new Request(`${BASE_URL}/supabase/sql.query/execute`, { method: 'POST', body: JSON.stringify(body) }),
    ctx,
    ['supabase', 'sql.query', 'execute'],
  );
  const json = await res.json() as { data?: { success?: boolean; data?: { rows: unknown[] }; error?: { code: string } }; code?: string };
  return { status: res.status, rows: json.data?.data?.rows, code: json.data?.error?.code ?? json.code };
}

const raw = (sql: string) => ({ connectionId: CONN, params: { body: { sql } } });

describe('scoped viewers cannot send SQL', () => {
  const variants: Record<string, string> = {
    'placeholder in a line comment': `SELECT * FROM ${TABLE} -- :viewer_scope`,
    'placeholder in a block comment': `SELECT * FROM ${TABLE} /* :viewer_scope */`,
    'placeholder in a string literal': `SELECT *, ':viewer_scope' AS x FROM ${TABLE}`,
    'placeholder OR-ed away': `SELECT * FROM ${TABLE} WHERE company_id IN (:viewer_scope) OR 1=1`,
    'multiple statements': `SELECT * FROM ${TABLE} WHERE company_id IN (:viewer_scope); SELECT * FROM ${TABLE}`,
    'CTE that ignores the scoped subquery': `WITH s AS (SELECT * FROM ${TABLE} WHERE company_id IN (:viewer_scope)) SELECT * FROM ${TABLE}`,
    'aliased scope column': `SELECT 1 AS company_id, revenue FROM ${TABLE} WHERE 1 IN (:viewer_scope)`,
    'a correctly scoped query': `SELECT * FROM ${TABLE} WHERE company_id IN (:viewer_scope)`,
  };

  for (const [label, sql] of Object.entries(variants)) {
    it(`rejects raw SQL: ${label}`, async () => {
      const r = await viewerRequest(ACME, raw(sql));
      expect(r.status).toBe(403);
      expect(r.code).toBe('SCOPE_REQUIRED');
      expect(providerSql).toEqual([]);
    });
  }

  it('rejects raw SQL sent through queryParams or a proxy token', async () => {
    const viaQuery = await viewerRequest(ACME, { connectionId: CONN, params: { queryParams: { sql: `SELECT * FROM ${TABLE} -- :viewer_scope` } } });
    const viaToken = await viewerRequest(ACME, { proxyToken: 'tok', params: { body: { sql: `SELECT * FROM ${TABLE} -- :viewer_scope` } } });
    expect([viaQuery.code, viaToken.code]).toEqual(['SCOPE_REQUIRED', 'SCOPE_REQUIRED']);
    expect(providerSql).toEqual([]);
  });

  it('ignores viewer params sent alongside a declared query', async () => {
    const r = await viewerRequest(ACME, { query: 'by_placeholder', ...raw(`SELECT * FROM ${TABLE}`) });
    expect(r.status).toBe(200);
    expect(r.rows).toEqual([{ company_id: 1, revenue: 10 }]);
  });

  it('rejects an undeclared name, or a declared name on another provider/endpoint/connection', async () => {
    expect((await viewerRequest(ACME, { query: 'nope' })).code).toBe('SCOPE_REQUIRED');
    expect((await viewerRequest(ACME, { query: 'by_placeholder', connectionId: 'conn_other' })).code).toBe('SCOPE_REQUIRED');
    expect((await viewerRequest(ACME, { query: 'constructor' })).code).toBe('SCOPE_REQUIRED');
    expect((await viewerRequest(ACME, { query: 42 })).status).toBe(400);
    expect(providerSql).toEqual([]);
  });
});

describe('declared queries return each viewer only their rows', () => {
  it('binds the scope into a :viewer_scope placeholder', async () => {
    expect((await viewerRequest(ACME, { query: 'by_placeholder' })).rows).toEqual([{ company_id: 1, revenue: 10 }]);
    expect((await viewerRequest(GLOBEX, { query: 'by_placeholder' })).rows).toEqual([{ company_id: 2, revenue: 20 }]);
    expect((await viewerRequest(NOBODY, { query: 'by_placeholder' })).rows).toEqual([]);
    expect((await viewerRequest(ACME, { query: 'totals' })).rows).toEqual([{ total: 10 }]);
  });

  it('wraps a query without a placeholder in a row filter on the policy field', async () => {
    expect((await viewerRequest(ACME, { query: 'by_wrap' })).rows).toEqual([{ company_id: 1, revenue: 10 }]);
    expect((await viewerRequest(GLOBEX, { query: 'by_wrap' })).rows).toEqual([{ company_id: 2, revenue: 20 }]);
    expect((await viewerRequest(NOBODY, { query: 'by_wrap' })).rows).toEqual([]);
  });

  it('treats a placeholder that only appears in a comment as absent and wraps', async () => {
    expect((await viewerRequest(ACME, { query: 'commented_placeholder' })).rows).toEqual([{ company_id: 1, revenue: 10 }]);
  });
});

describe('fail closed', () => {
  it('rejects every scoped request when the stored policy declares no queries', async () => {
    const { queries: _q, ...noQueries } = POLICY;
    const r = await viewerRequest(ACME, { query: 'by_placeholder' }, noQueries);
    expect(r.code).toBe('SCOPE_REQUIRED');
    expect(providerSql).toEqual([]);
  });

  it('rejects a stored policy whose query is not a single statement (it never parses)', async () => {
    const bad = { ...POLICY, queries: { two: { ...POLICY.queries!.by_wrap, params: { body: { sql: `SELECT * FROM ${TABLE}; SELECT 1` } } } } };
    expect(parseAccessPolicy(JSON.stringify(bad))).toBeNull();
    const r = await viewerRequest(ACME, { query: 'two' }, bad);
    expect(r.code).toBe('SCOPE_REQUIRED');
    expect(providerSql).toEqual([]);
  });

  it('a wrapped query that does not return the policy field errors instead of returning rows', async () => {
    const policy = { ...POLICY, queries: { agg: { ...POLICY.queries!.by_wrap, params: { body: { sql: `SELECT SUM(revenue) AS total FROM ${TABLE}` } } } } };
    const r = await viewerRequest(ACME, { query: 'agg' }, policy);
    expect(r.rows).toBeUndefined();
    expect(r.status).not.toBe(200);
  });

  it('engine refuses a scoped request that names no declared query', async () => {
    const engine = new PlatformEngine({ artifactId: `art_vs_${++seq}`, env: await platformEnv(), viewerScope: ACME, accessPolicy: POLICY });
    const r = await engine.execute({ provider: 'supabase', endpoint: 'sql.query', connectionId: CONN, params: { body: { sql: `SELECT * FROM ${TABLE} WHERE company_id IN (:viewer_scope)` } } });
    expect(r.error?.code).toBe('SCOPE_REQUIRED');
    expect(providerSql).toEqual([]);
  });
});

describe('unscoped callers (owner, editor, default-allow)', () => {
  const engine = async () => new PlatformEngine({ artifactId: `art_vs_${++seq}`, env: await platformEnv(), viewerScope: null, accessPolicy: POLICY });

  it('raw SQL runs as written', async () => {
    const r = await (await engine()).execute<{ rows: unknown[] }>({ provider: 'supabase', endpoint: 'sql.query', connectionId: CONN, params: { body: { sql: `SELECT company_id FROM ${TABLE} ORDER BY company_id` } } });
    expect(r.data?.rows).toEqual([{ company_id: 1 }, { company_id: 2 }, { company_id: 3 }]);
  });

  it('a declared placeholder query gets every value the policy names', async () => {
    const r = await (await engine()).execute<{ rows: unknown[] }>({ provider: 'supabase', endpoint: 'sql.query', connectionId: '', policyQuery: 'by_placeholder' });
    expect(r.data?.rows).toEqual([{ company_id: 1, revenue: 10 }, { company_id: 2, revenue: 20 }]);
  });

  it('a declared query without a placeholder runs unwrapped', async () => {
    const r = await (await engine()).execute<{ rows: unknown[] }>({ provider: 'supabase', endpoint: 'sql.query', connectionId: '', policyQuery: 'by_wrap' });
    expect(r.data?.rows).toHaveLength(3);
  });

  it('an unknown declared name is a 404', async () => {
    const r = await viewerRequest(null, { query: 'nope' });
    expect([r.status, r.code]).toEqual([404, 'QUERY_NOT_FOUND']);
  });
});

describe('validateAccessPolicy queries', () => {
  const withQuery = (q: unknown) => ({ ...POLICY, queries: { q } });

  it('accepts the declared queries above', () => {
    expect(validateAccessPolicy(POLICY)).toBeNull();
  });

  it('rejects malformed declarations', () => {
    expect(validateAccessPolicy({ ...POLICY, queries: [] })).toMatch(/queries must be an object/);
    expect(validateAccessPolicy({ ...POLICY, queries: { 'bad name!': POLICY.queries!.by_wrap } })).toMatch(/names use/);
    expect(validateAccessPolicy(withQuery({ ...POLICY.queries!.by_wrap, connection: '' }))).toMatch(/connection/);
    expect(validateAccessPolicy(withQuery({ ...POLICY.queries!.by_wrap, params: { body: {} } }))).toMatch(/exactly one SQL string/);
    expect(validateAccessPolicy(withQuery({ ...POLICY.queries!.by_wrap, params: { body: { sql: 'SELECT 1; SELECT 2' } } }))).toMatch(/single statement/);
    expect(validateAccessPolicy(withQuery({ ...POLICY.queries!.by_wrap, params: { body: { sql: "SELECT 'x" } } }))).toMatch(/unterminated/);
  });

  it('requires a placeholder when the policy field is not a plain column name', () => {
    const p = { ...POLICY, field: 'org.id', queries: { q: POLICY.queries!.by_wrap } };
    expect(validateAccessPolicy(p)).toMatch(/must use :viewer_scope/);
    expect(validateAccessPolicy({ ...p, queries: { q: POLICY.queries!.by_placeholder } })).toBeNull();
  });
});
