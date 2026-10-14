# Amazon S3, Supabase, Amazon Redshift, Amazon Aurora

Four workspace platform connectors (`kind: platform`). All run server-side over HTTPS —
the page never sees a key. Admins add them in **Connectors** (Home) or with the API below;
**Test** works before saving (`POST /v1/workspaces/{id}/connections/test`).

| Provider id | Reaches | Auth | Endpoints |
|---|---|---|---|
| `s3` | One S3 bucket (or S3-compatible: R2, MinIO) | IAM access key | `objects.list`, `objects.get`, `objects.presign` |
| `supabase` | One Supabase project's Postgres | Supabase access token | `sql.query` (read-only, enforced by Supabase) |
| `redshift` | Redshift Serverless workgroup or provisioned cluster | IAM access key | `sql.query` (Redshift Data API) |
| `aurora` | Aurora PostgreSQL / MySQL cluster | IAM access key + Secrets Manager secret | `sql.query` (RDS Data API) |

**Not supported:** plain (non-Aurora) Amazon RDS for PostgreSQL/MySQL and self-hosted
Postgres. Those need a raw TCP+TLS socket, and a Worker cannot trust their private CA
(RDS, Supabase pooler). Use Aurora with the Data API, Supabase, or a REST connector.

All four connectors are **read-only**. S3 has no write endpoint; Supabase runs as
`supabase_read_only_user`. For Redshift and Aurora the database user is the boundary —
give the connector a read-only login.

## Create (API)

`credentials.type: "aws_access_key"` → `data: { access_key_id, secret_access_key, session_token? }`.
Supabase uses `credentials.type: "oauth"` → `data: { access_token: "sbp_…" }`.

```json
{ "name": "exports", "kind": "platform", "provider": "s3",
  "config": { "bucket": "acme-exports", "region": "us-east-1", "prefix": "exports/" },
  "credentials": { "type": "aws_access_key", "data": { "access_key_id": "AKIA…", "secret_access_key": "…" } } }
```

| Provider | `config` |
|---|---|
| `s3` | `bucket`, `region` · optional `prefix` (locks the connector to that folder), `endpoint` (https S3-compatible URL; `region` then optional) |
| `supabase` | `project_ref` — the 20-char ref, the project URL, a dashboard URL or a pooler connection string all work |
| `redshift` | `region`, `database`, and **one of** `workgroup_name` (Serverless) or `cluster_identifier` (provisioned; also needs `db_user` or `secret_arn`) |
| `aurora` | `resource_arn` (cluster ARN — the region is read from it), `secret_arn`, `database` · optional `schema` |

IAM permissions: S3 → `s3:ListBucket` + `s3:GetObject` on the bucket. Redshift →
`redshift-data:*` plus `redshift-serverless:GetCredentials` / `redshift:GetClusterCredentials`
or `secretsmanager:GetSecretValue`. Aurora → `rds-data:ExecuteStatement` +
`secretsmanager:GetSecretValue` on the secret, and the cluster's Data API turned on.

## Query from an artifact

```javascript
const sdk = await ShareOut.create();
const conns = await sdk.platform.connections();
const wh = conns.find((c) => c.name === 'warehouse');

// Supabase, Redshift, Aurora — same call, same shape: { columns, rows }
const { data } = await sdk.platform.execute('redshift', 'sql.query', {
  connectionId: wh.id,
  params: { body: { sql: 'select region, sum(revenue) as revenue from sales group by 1', maxRows: 5000 } },
});
data.rows; // [{ region: 'EU', revenue: 1200.5 }, …]
```

`sql.query` body: `sql` (required), `maxRows` (≤ 10 000), `timeoutMs` (Redshift, ≤ 120 000).
Numerics come back as numbers. Row-level access policies apply as for Snowflake: a scoped
viewer's SQL must contain `:viewer_scope` (see [../core/access-policy.md](../core/access-policy.md)).

```javascript
const s3 = sdk.platform.provider('s3');
const ls = await s3.execute('objects.list', { connectionId, params: { queryParams: { prefix: 'exports/' } } });
// ls.data → { objects: [{ key, size, lastModified, etag }], prefixes: ['exports/2026/'], isTruncated, nextContinuationToken }

const f = await s3.execute('objects.get', { connectionId, params: { queryParams: { key: 'exports/orders.csv' } } });
// CSV → f.data.rows (header-keyed strings) · JSON → f.data.data · text → f.data.text

const dl = await s3.execute('objects.presign', { connectionId, params: { body: { key: 'reports/q3.pdf', expiresIn: 900 } } });
// dl.data.url — signed GET, ≤ 3600 s; use for files over 10 MB or binary (parquet, images, PDFs)
```

`objects.get` reads up to **10 MB** and only CSV/JSON/text (inferred from the extension,
or force `format: 'csv' | 'json' | 'text'`). Anything else → `415`, too big → `413`; both
point you at `objects.presign`. A key or prefix outside the connector's `prefix` → `403
PREFIX_FORBIDDEN`. `objects.list` and `objects.get` are cached (60 s / 300 s).

## Workspace assistant, crews, scheduled jobs

With **AI** switched on for the connector (Connectors card → AI checkbox):

- `query_connection` runs read-only `SELECT`s on `supabase`, `redshift` and `aurora` like Snowflake/BigQuery.
- `browse_storage` lists folders (`action: "list"`, `prefix`) and reads files (`action: "read"`, `key`) on `s3`.
- `list_connections` reports `queryable` (SQL) and `files` (S3) per connector.

Crews, materialize and scheduled snapshots use `queryConnectionAny`, which accepts the
three SQL providers by name.

The same three tools are on the MCP connector (`{origin}/mcp`), so Claude, ChatGPT and
other MCP clients signed in as a workspace member get the same read-only access, under
the same AI switch — see [mcp-connector.md](mcp-connector.md).
