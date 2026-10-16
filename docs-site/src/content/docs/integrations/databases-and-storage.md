---
title: S3, Supabase, Redshift & Aurora
description: Read files from Amazon S3 and query Supabase, Amazon Redshift and Amazon Aurora from your pages and the assistant.
---

Four workspace connectors for the data most teams already keep on AWS or Supabase.
Add them once under **Connectors**, press **Test**, and every page — and the assistant,
if you allow it — can use them by name. Keys are encrypted and never reach the browser.

All four are **read-only**.

## Amazon S3

Lists a bucket and reads CSV, JSON and text files. Bigger or binary files (PDF, images,
Parquet) get a short-lived download link instead.

1. In AWS, create an IAM user with **`s3:ListBucket`** and **`s3:GetObject`** on the bucket.
2. **Connectors → Amazon S3**: bucket, region, access key ID and secret.
3. Optional **Folder** limits the connector to one prefix (e.g. `exports/`).
4. Optional **S3-compatible endpoint** for Cloudflare R2, MinIO and similar.

```javascript
const sdk = await ShareOut.create();
const s3 = sdk.platform.provider('s3');
const { data } = await s3.execute('objects.get', {
  connectionId,
  params: { queryParams: { key: 'exports/orders.csv' } },
});
console.log(data.rows); // one object per CSV row, keyed by the header
```

| Endpoint | Does |
| --- | --- |
| `objects.list` | Folders and files under `prefix` |
| `objects.get` | One file up to 10 MB: CSV → `rows`, JSON → `data`, text → `text` |
| `objects.presign` | A signed download URL, valid up to one hour |

## Supabase

Runs SQL through Supabase's read-only query endpoint, as the built-in
`supabase_read_only_user` — writes are impossible by design.

1. In Supabase, **Account → Access Tokens → Generate new token**.
2. **Connectors → Supabase**: paste the project URL (or ref) and the token.

## Amazon Redshift

Uses the **Redshift Data API**, so private clusters work without opening them to the
internet.

1. Create an IAM user with `redshift-data:*` and either
   `redshift-serverless:GetCredentials` / `redshift:GetClusterCredentials` or
   `secretsmanager:GetSecretValue` for a stored login.
2. **Connectors → Amazon Redshift**: region, Serverless workgroup or cluster name,
   database, and — for a provisioned cluster — a database user or a Secrets Manager ARN.
3. Give that database user read-only grants.

## Amazon Aurora

Aurora PostgreSQL and Aurora MySQL through the **RDS Data API**.

1. Turn on the Data API for the cluster (RDS console → Modify → *Data API*).
2. Store a read-only database login in Secrets Manager.
3. Create an IAM user with `rds-data:ExecuteStatement` and `secretsmanager:GetSecretValue`
   on that secret.
4. **Connectors → Amazon Aurora**: cluster ARN, secret ARN, database.

Plain (non-Aurora) Amazon RDS and self-hosted Postgres are not supported yet: they need a
direct database socket, which ShareOut's runtime can't open to databases signed by a
private certificate authority.

## Query the SQL connectors

Supabase, Redshift and Aurora share one endpoint and one result shape:

```javascript
const { data } = await sdk.platform.execute('supabase', 'sql.query', {
  connectionId,
  params: { body: { sql: 'select status, count(*) as n from orders group by 1' } },
});
// data → { columns: ['status', 'n'], rows: [{ status: 'paid', n: 31 }, …] }
```

Pass `maxRows` (up to 10 000) to cap the result. On pages with a row-level access policy,
viewers can only run queries declared in `access_policy.queries`, as with Snowflake.

## The assistant

Tick **AI** on the connector card and the workspace assistant can query it: SQL
connectors through read-only `SELECT`s, S3 by browsing folders and reading files.
