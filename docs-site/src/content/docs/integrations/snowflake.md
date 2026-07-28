---
title: Snowflake
description: Query your Snowflake warehouse from an artifact, with key-pair auth.
---

Query Snowflake from a page. The connection lives at the **workspace** level with your
own credentials; artifacts read through it and never see the key.

## Connect

**Connectors → Add → Snowflake.** Snowflake here uses **key-pair authentication**, not a
password — ShareOut signs a JWT with your private key on each request.

Generate the key pair:

```bash
# private key, unencrypted PKCS#8 — this is the format the connector expects
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out shareout_key.p8 -nocrypt

# matching public key
openssl rsa -in shareout_key.p8 -pubout -out shareout_key.pub
```

Register the public key on the Snowflake user:

```sql
ALTER USER my_user SET RSA_PUBLIC_KEY='MIIBIjANBgkq...';   -- contents of shareout_key.pub, no header/footer
DESC USER my_user;                                          -- read RSA_PUBLIC_KEY_FP
```

Then fill the connector form:

| Field | Value |
|-------|-------|
| `account` | Your account identifier, e.g. `ab12345.us-east-1` (the part before `.snowflakecomputing.com`) |
| `user` | The Snowflake user the public key was set on |
| `private_key` | Contents of `shareout_key.p8`, **PKCS#8, unencrypted** |
| `public_key_fingerprint` | The `RSA_PUBLIC_KEY_FP` value from `DESC USER` |

If the private key is in the wrong format the connector fails with
`Invalid PKCS8 input` — regenerate with the `-topk8 -nocrypt` flags above.

## Query from an artifact

```javascript
const sdk = await ShareOut.create();
const warehouse = sdk.connection('snowflake');

const { data } = await warehouse.query(`
  SELECT customer, SUM(amount) AS revenue
  FROM analytics.public.invoices
  WHERE invoice_date >= DATEADD(day, -30, CURRENT_DATE())
  GROUP BY customer
  ORDER BY revenue DESC
  LIMIT 20
`);
```

Give the query a warehouse, database and schema either fully-qualified in the SQL (as
above) or by setting defaults on the Snowflake user — the connector does not guess them.

## Don't query on every view

Snowflake bills by warehouse time, so a dashboard that queries on each page load keeps a
warehouse awake. Materialize on a schedule and let the page read the stored result:

```javascript
await warehouse.materialize({
  query: 'SELECT customer, SUM(amount) AS revenue FROM analytics.public.invoices GROUP BY customer',
  to: 'table:revenue_by_customer',
  mode: 'replace',
});
```

## Notes

- Queries run **through the Worker**. There is no direct browser path.
- Run them **sequentially** — a burst of parallel statements against one warehouse tends
  to queue rather than parallelize.
- The private key is encrypted at rest and never reaches the browser.
- Test a connection with `POST /v1/workspaces/{id}/connections/test` before wiring a
  dashboard to it.
