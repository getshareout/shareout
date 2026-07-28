# Snowflake connector

A reusable ShareOut Data Platform provider for Snowflake, built like the BigQuery
connector so it can be pointed at any customer's account. It runs **proxy-only**:
queries execute server-side via Snowflake's **SQL API v2** using **key-pair (JWT)**
authentication. No password, no OAuth, no browser flow.

## How it authenticates

Each request mints a short-lived RS256 JWT (`KEYPAIR_JWT`) signed with the user's
RSA private key. The matching public key is registered on the Snowflake user; its
fingerprint goes in the connection config. See [jwt.ts](./jwt.ts).

## One-time Snowflake setup (per customer)

```sql
-- 1. Generate an unencrypted PKCS#8 key pair locally:
--    openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out rsa_key.p8 -nocrypt
--    openssl rsa -in rsa_key.p8 -pubout -out rsa_key.pub

-- 2. Register the public key on a dedicated service user:
ALTER USER SVC_ANALYTICS SET RSA_PUBLIC_KEY='MIIBIj...';   -- contents of rsa_key.pub, no header/footer/newlines

-- 3. Read back the fingerprint (used as publicKeyFingerprint):
DESC USER SVC_ANALYTICS;   -- copy the RSA_PUBLIC_KEY_FP value, e.g. SHA256:abc...
```

Grant the user the role/warehouse/database it needs to read.

## Create a connection (via the artifact's data API)

`POST /v1/data/{artifactId}/platform/connections`

```json
{
  "name": "acme-snowflake",
  "provider": "snowflake",
  "preferredMode": "proxy",
  "config": {
    "account": "xy12345",
    "user": "SVC_ANALYTICS",
    "role": "ANALYST",
    "warehouse": "ANALYTICS_WH",
    "database": "ANALYTICS_WH",
    "schema": "CUSTOMER_METRICS",
    "publicKeyFingerprint": "SHA256:abc123..."
  },
  "credentials": {
    "extra": { "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" }
  }
}
```

The private key is encrypted at rest with the platform `CREDENTIALS_KEY`; it is never
returned by the API and never reaches the browser (proxy-only execution).

### Config fields

| Field | Required | Notes |
|-------|----------|-------|
| `account` | ✓ | Host subdomain → `https://{account}.snowflakecomputing.com` |
| `user` | ✓ | Service user that owns the public key |
| `publicKeyFingerprint` | ✓ | `RSA_PUBLIC_KEY_FP` from `DESC USER` (`SHA256:...`) |
| `role`, `warehouse`, `database`, `schema` | – | Defaults applied to every statement |
| `accountIdentifier` | – | Override the JWT account (defaults to `account` upper-cased, region stripped) — set this for org-style or region-locator accounts if auth fails |
| `host` | – | Full host override (PrivateLink, custom domains) |

## Run a query

`POST /v1/data/{artifactId}/platform/snowflake/statements.execute/execute`

```json
{
  "connectionId": "conn_...",
  "params": { "body": { "statement": "SELECT * FROM CUSTOMER_METRICS.ADOPTION LIMIT 100" } }
}
```

Returns the SQL API payload: `{ resultSetMetaData, data: [[...], ...] }`. Long-running
statements return `202` and are polled to completion automatically. Bind variables and
session `parameters` are passed through `params.body.bindings` / `params.body.parameters`.

## Reuse for another customer

Create a new connection with that customer's `account` / `user` / key — the provider
code is shared. Connections can be artifact-scoped or workspace-scoped (shared across a
team's artifacts) just like every other provider.
