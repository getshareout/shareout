---
title: BigQuery
description: Query Google Cloud datasets from an artifact, with your own credentials.
---

Query BigQuery from a page. The connection lives at the **workspace** level with your
own Google credentials; artifacts read through it and never see the key.

## Connect

**Connectors → Add → Google BigQuery.** The connect method is a **service account**:

1. In Google Cloud, create a service account with the **BigQuery User** and
   **BigQuery Data Viewer** roles on the project you want to read.
2. Create a JSON key for it and download the file.
3. Paste the JSON into the connector form and name the connection (for example
   `warehouse`).

The OAuth path is also supported, but only if the instance operator has set
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — on a self-hosted instance those are
often unset, and the service-account path avoids needing them at all.

## Query from an artifact

```javascript
const sdk = await ShareOut.create();
const warehouse = sdk.connection('warehouse');

const { data, rowCount, cached } = await warehouse.query(`
  SELECT country, COUNT(*) AS orders
  FROM \`my-project.sales.orders\`
  WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  GROUP BY country
  ORDER BY orders DESC
`);
```

`fetch()` is the same call when you only want the rows:

```javascript
const rows = await warehouse.fetch('SELECT 1 AS ok');
```

## Don't query on every view

A dashboard that hits BigQuery on each page load is slow and bills you per view.
Materialize instead — run the query on a schedule, store the result, and let the page
read the stored copy:

```javascript
await warehouse.materialize({
  query: 'SELECT country, COUNT(*) AS orders FROM `my-project.sales.orders` GROUP BY country',
  to: 'dataset:orders_by_country',
});
```

The page then reads `dataset:orders_by_country` with no live warehouse hit. Pair it with
a schedule so the numbers stay current.

## Notes

- Queries run **through the Worker** (proxy mode). BigQuery does not allow direct
  browser calls, so there is no CORS path.
- Billing is Google's, on your project. A `SELECT *` over a large table costs real money
  — scope the query.
- The credential is encrypted at rest and never reaches the browser.
- Test a connection with `POST /v1/workspaces/{id}/connections/test` before wiring a
  dashboard to it.
