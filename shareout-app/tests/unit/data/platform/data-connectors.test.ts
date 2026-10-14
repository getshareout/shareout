// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../../src/data/platform';
import { getProvider, listProviders } from '../../../../src/data/platform/registry';
import { parseListObjects, parseCsv, s3ConfigError, s3ObjectUrl, s3Provider } from '../../../../src/data/platform/providers/s3';
import { parseSupabaseRef, supabaseProvider } from '../../../../src/data/platform/providers/supabase';
import { parseRedshiftRecords, redshiftConfigError, redshiftProvider } from '../../../../src/data/platform/providers/redshift';
import { auroraConfigError, auroraProvider } from '../../../../src/data/platform/providers/aurora';
import { isSqlProvider } from '../../../../src/data/connections/warehouse-query';
import type { ExecutionContext, DecryptedCredentials } from '../../../../src/data/platform/types';
import { publicArtifactEnv } from './helpers';

const AWS: DecryptedCredentials = { access_token: '', extra: { access_key_id: 'AKIAEXAMPLE', secret_access_key: 'secret' } };

function ctx(provider: string, config: Record<string, unknown>, credentials: DecryptedCredentials = AWS): ExecutionContext {
  return {
    artifactId: 'art_1',
    connectionId: 'conn_1',
    connectionConfig: { id: 'conn_1', name: 'c', provider, preferredMode: 'proxy', config, createdAt: '', updatedAt: '' },
    credentials,
    env: publicArtifactEnv(),
  };
}

/** Mock global fetch with a queue of responses; records each outgoing Request. */
function mockFetch(...responses: Response[]) {
  const calls: Request[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(input instanceof Request ? input : new Request(String(input), init));
    const r = responses.shift();
    if (!r) throw new Error('unexpected fetch');
    return r;
  });
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('catalog registration', () => {
  it('registers S3, Supabase, Redshift and Aurora as testable catalog cards', () => {
    for (const id of ['s3', 'supabase', 'redshift', 'aurora']) {
      const p = getProvider(id)!;
      expect(p.config.display?.testable).toBe(true);
      expect(p.requiresProxy()).toBe(true);
    }
    const byId = Object.fromEntries(listProviders().map((p) => [p.id, p.display?.category]));
    expect(byId).toMatchObject({ s3: 'storage', supabase: 'warehouse', redshift: 'warehouse', aurora: 'warehouse' });
  });

  it('treats every sql.query provider as server-side SQL, and S3 as not', () => {
    expect(['bigquery', 'snowflake', 'supabase', 'redshift', 'aurora'].every(isSqlProvider)).toBe(true);
    expect(isSqlProvider('s3')).toBe(false);
    expect(isSqlProvider('shopify')).toBe(false);
  });
});

describe('S3', () => {
  const cfg = { bucket: 'acme-exports', region: 'us-east-1' };

  it('builds virtual-host, dotted-bucket and custom-endpoint URLs', () => {
    expect(s3ObjectUrl(cfg, 'a b/c.csv')).toBe('https://acme-exports.s3.us-east-1.amazonaws.com/a%20b/c.csv');
    expect(s3ObjectUrl({ bucket: 'acme.data', region: 'eu-west-1' }, 'x')).toBe('https://s3.eu-west-1.amazonaws.com/acme.data/x');
    expect(s3ObjectUrl({ bucket: 'b1', endpoint: 'https://acct.r2.cloudflarestorage.com/' }, 'k')).toBe('https://acct.r2.cloudflarestorage.com/b1/k');
  });

  it('validates bucket, region and endpoint', () => {
    expect(s3ConfigError(cfg)).toBeNull();
    expect(s3ConfigError({ bucket: 'Bad_Bucket', region: 'us-east-1' })).toMatch(/bucket/);
    expect(s3ConfigError({ bucket: 'ok-bucket', region: 'mars' })).toMatch(/region/);
    expect(s3ConfigError({ bucket: 'ok-bucket', endpoint: 'http://minio.local' })).toMatch(/https/);
  });

  it('parses ListObjectsV2 XML, decoding entities', () => {
    const xml = `<ListBucketResult><IsTruncated>true</IsTruncated>
      <Contents><Key>exports/a&amp;b.csv</Key><LastModified>2026-10-01T00:00:00.000Z</LastModified><ETag>&quot;abc&quot;</ETag><Size>42</Size></Contents>
      <CommonPrefixes><Prefix>exports/2026/</Prefix></CommonPrefixes>
      <NextContinuationToken>tok</NextContinuationToken></ListBucketResult>`;
    expect(parseListObjects(xml)).toEqual({
      objects: [{ key: 'exports/a&b.csv', size: 42, lastModified: '2026-10-01T00:00:00.000Z', etag: 'abc' }],
      prefixes: ['exports/2026/'],
      isTruncated: true,
      nextContinuationToken: 'tok',
    });
  });

  it('parses CSV with quoted commas and CRLF', () => {
    expect(parseCsv('name,city\r\n"Doe, J",NYC\r\nAnn,LA\r\n')).toEqual([{ name: 'Doe, J', city: 'NYC' }, { name: 'Ann', city: 'LA' }]);
  });

  it('lists with a SigV4-signed request', async () => {
    const calls = mockFetch(new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'));
    const res = await s3Provider.executeRequest(ctx('s3', cfg), s3Provider.getEndpoint('objects.list')!, { queryParams: { prefix: 'exports/' } });
    expect(res.success).toBe(true);
    const url = new URL(calls[0].url);
    expect(url.host).toBe('acme-exports.s3.us-east-1.amazonaws.com');
    expect(url.searchParams.get('list-type')).toBe('2');
    expect(url.searchParams.get('prefix')).toBe('exports/');
    expect(calls[0].headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request/);
  });

  it('reads a CSV object as rows', async () => {
    mockFetch(new Response('id,total\n1,9.5\n', { headers: { 'content-type': 'text/csv', 'content-length': '15' } }));
    const res = await s3Provider.executeRequest<{ rows: unknown[]; format: string }>(ctx('s3', cfg), s3Provider.getEndpoint('objects.get')!, { queryParams: { key: 'exports/orders.csv' } });
    expect(res.data).toMatchObject({ format: 'csv', rowCount: 1, rows: [{ id: '1', total: '9.5' }] });
  });

  it('keeps every key and prefix inside the configured folder', async () => {
    const locked = { ...cfg, prefix: 'exports' };
    const get = await s3Provider.executeRequest(ctx('s3', locked), s3Provider.getEndpoint('objects.get')!, { queryParams: { key: 'secrets/keys.json' } });
    expect(get).toMatchObject({ success: false, status: 403, error: { code: 'PREFIX_FORBIDDEN' } });
    const list = await s3Provider.executeRequest(ctx('s3', locked), s3Provider.getEndpoint('objects.list')!, { queryParams: { prefix: '' } });
    expect(list).toMatchObject({ success: false, status: 403 });
  });

  it('refuses objects over 10 MB and binary files, pointing at presign', async () => {
    mockFetch(new Response('x', { headers: { 'content-length': String(11 * 1024 * 1024) } }));
    const big = await s3Provider.executeRequest(ctx('s3', cfg), s3Provider.getEndpoint('objects.get')!, { queryParams: { key: 'big.csv' } });
    expect(big).toMatchObject({ success: false, status: 413 });
    mockFetch(new Response('PAR1', { headers: { 'content-type': 'application/octet-stream' } }));
    const bin = await s3Provider.executeRequest(ctx('s3', cfg), s3Provider.getEndpoint('objects.get')!, { queryParams: { key: 'data.parquet' } });
    expect(bin).toMatchObject({ success: false, status: 415 });
    expect(bin.error?.message).toMatch(/presign/);
  });

  it('presigns a capped, query-signed GET URL without calling S3', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await s3Provider.executeRequest<{ url: string }>(ctx('s3', cfg), s3Provider.getEndpoint('objects.presign')!, { body: { key: 'report.pdf', expiresIn: 99999 } });
    const url = new URL(res.data!.url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails cleanly without stored keys', async () => {
    const res = await s3Provider.executeRequest(ctx('s3', cfg, { access_token: '' }), s3Provider.getEndpoint('objects.list')!, {});
    expect(res.error?.code).toBe('MISSING_CREDENTIALS');
  });
});

describe('Supabase', () => {
  it('accepts a ref, project URL, dashboard URL or pooler connection string', () => {
    const ref = 'abcdefghijklmnopqrst';
    expect(parseSupabaseRef(ref)).toBe(ref);
    expect(parseSupabaseRef(`https://${ref}.supabase.co`)).toBe(ref);
    expect(parseSupabaseRef(`https://supabase.com/dashboard/project/${ref}/editor`)).toBe(ref);
    expect(parseSupabaseRef(`postgresql://postgres.${ref}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`)).toBe(ref);
    expect(parseSupabaseRef('nope')).toBeNull();
  });

  it('runs SQL on the read-only endpoint and returns columns + rows', async () => {
    const calls = mockFetch(json([{ status: 'paid', n: 3 }, { status: 'open', n: 1 }], 201));
    const res = await supabaseProvider.executeRequest(
      ctx('supabase', { project_ref: 'https://abcdefghijklmnopqrst.supabase.co' }, { access_token: 'sbp_x' }),
      supabaseProvider.getEndpoint('sql.query')!,
      { body: { sql: 'select status, count(*) n from orders group by 1', maxRows: 1 } },
    );
    expect(calls[0].url).toBe('https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query/read-only');
    expect(calls[0].headers.get('authorization')).toBe('Bearer sbp_x');
    expect(await calls[0].json()).toEqual({ query: 'select status, count(*) n from orders group by 1' });
    expect(res.data).toEqual({ columns: ['status', 'n'], rows: [{ status: 'paid', n: 3 }] });
  });

  it('explains a rejected token', async () => {
    mockFetch(json({ message: 'Unauthorized' }, 401));
    const res = await supabaseProvider.verifyConnection!(publicArtifactEnv(), { project_ref: 'abcdefghijklmnopqrst' }, { access_token: 'bad' });
    expect(res).toEqual({ ok: false, message: 'Supabase rejected the access token' });
  });
});

describe('Redshift', () => {
  it('requires exactly one target and a login for provisioned clusters', () => {
    const base = { region: 'us-east-1', database: 'dev' };
    expect(redshiftConfigError({ ...base, workgroup_name: 'wg' })).toBeNull();
    expect(redshiftConfigError(base)).toMatch(/either/);
    expect(redshiftConfigError({ ...base, workgroup_name: 'wg', cluster_identifier: 'c' })).toMatch(/either/);
    expect(redshiftConfigError({ ...base, cluster_identifier: 'c' })).toMatch(/user or a Secrets Manager/);
    expect(redshiftConfigError({ ...base, cluster_identifier: 'c', db_user: 'ro' })).toBeNull();
  });

  it('coerces Data API fields by type', () => {
    const rows = parseRedshiftRecords(
      [{ name: 'region', typeName: 'varchar' }, { name: 'rev', typeName: 'numeric' }, { name: 'n', typeName: 'int8' }, { name: 'x', typeName: 'varchar' }],
      [[{ stringValue: 'EU' }, { stringValue: '10.50' }, { longValue: 7 }, { isNull: true }]],
    );
    expect(rows).toEqual([{ region: 'EU', rev: 10.5, n: 7, x: null }]);
  });

  it('submits, polls and pages the statement result', async () => {
    const calls = mockFetch(
      json({ Id: 'st-1' }),
      json({ Status: 'FINISHED', HasResultSet: true }),
      json({ ColumnMetadata: [{ name: 'n', typeName: 'int4' }], Records: [[{ longValue: 1 }]], NextToken: 'p2' }),
      json({ Records: [[{ longValue: 2 }]] }),
    );
    const res = await redshiftProvider.executeRequest(
      ctx('redshift', { region: 'eu-west-1', database: 'dev', workgroup_name: 'analytics' }),
      redshiftProvider.getEndpoint('sql.query')!,
      { body: { sql: 'select n from t' } },
    );
    expect(res.data).toEqual({ columns: ['n'], rows: [{ n: 1 }, { n: 2 }] });
    expect(calls.map((c) => c.headers.get('x-amz-target'))).toEqual([
      'RedshiftData.ExecuteStatement', 'RedshiftData.DescribeStatement', 'RedshiftData.GetStatementResult', 'RedshiftData.GetStatementResult',
    ]);
    expect(calls[0].url).toBe('https://redshift-data.eu-west-1.amazonaws.com/');
    expect(await calls[0].json()).toEqual({ Sql: 'select n from t', Database: 'dev', WorkgroupName: 'analytics' });
  });

  it('surfaces the database error when a statement fails', async () => {
    mockFetch(json({ Id: 'st-2' }), json({ Status: 'FAILED', Error: 'ERROR: relation "nope" does not exist' }));
    const res = await redshiftProvider.executeRequest(
      ctx('redshift', { region: 'us-east-1', database: 'dev', cluster_identifier: 'c1', db_user: 'ro' }),
      redshiftProvider.getEndpoint('sql.query')!,
      { body: { sql: 'select * from nope' } },
    );
    expect(res).toMatchObject({ success: false, error: { code: 'REDSHIFT_QUERY_FAILED', message: 'ERROR: relation "nope" does not exist' } });
  });
});

describe('Aurora', () => {
  const cfg = {
    resource_arn: 'arn:aws:rds:eu-central-1:123456789012:cluster:prod',
    secret_arn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:db-ro-AbCd',
    database: 'app',
  };

  it('validates the ARNs', () => {
    expect(auroraConfigError(cfg)).toBeNull();
    expect(auroraConfigError({ ...cfg, resource_arn: 'arn:aws:rds:eu-central-1:123456789012:db:single' })).toMatch(/Cluster ARN/);
    expect(auroraConfigError({ ...cfg, secret_arn: '' })).toMatch(/secret/);
  });

  it('runs through the RDS Data API in the ARN region and returns JSON records', async () => {
    const calls = mockFetch(json({ formattedRecords: '[{"plan":"pro","n":4}]', columnMetadata: [{ label: 'plan' }, { label: 'n' }] }));
    const res = await auroraProvider.executeRequest(ctx('aurora', cfg), auroraProvider.getEndpoint('sql.query')!, { body: { sql: 'select plan, count(*) n from accounts group by 1' } });
    expect(calls[0].url).toBe('https://rds-data.eu-central-1.amazonaws.com/Execute');
    expect(await calls[0].json()).toMatchObject({ resourceArn: cfg.resource_arn, secretArn: cfg.secret_arn, database: 'app', formatRecordsAs: 'JSON' });
    expect(res.data).toEqual({ columns: ['plan', 'n'], rows: [{ plan: 'pro', n: 4 }] });
  });

  it('surfaces the AWS error message', async () => {
    mockFetch(json({ message: 'HttpEndpoint is not enabled for cluster prod' }, 400));
    const res = await auroraProvider.verifyConnection!(publicArtifactEnv(), cfg, AWS);
    expect(res).toEqual({ ok: false, message: 'HttpEndpoint is not enabled for cluster prod' });
  });
});
