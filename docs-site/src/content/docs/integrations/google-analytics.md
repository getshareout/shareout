---
title: Google Analytics
description: GA4 reports and metrics via a workspace connector and pasted service-account key.
---

Query GA4 report data from inside an artifact via a **workspace connector**.
ShareOut mints short-lived tokens server-side from your pasted service-account
key — no ShareOut OAuth flow.

## Setup (workspace admin)

1. In Google Cloud, create a service account with the **Viewer** role on your GA4
   property (or add the service account email as a property user in GA4 Admin).
2. Download the JSON key.
3. In ShareOut → workspace **Connectors**, choose **Google Analytics** and paste
   the key plus your GA4 property ID.
4. Use **Test** to verify before saving.

See [Workspace connections](/teams/connections/) for the REST API.

## Query from an artifact

Reference the connector by name:

```javascript
const sdk = await ShareOut.create();

const { data } = await sdk.connection('team_ga').fetch({
  endpoint: 'reports.run',
  body: {
    dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
  },
  params: { propertyId: '123456789' },
});
```

`propertyId` can be `123456789` or `properties/123456789`.

## Endpoints

The provider calls the GA4 Data API (`analyticsdata.googleapis.com/v1beta`).

| Endpoint | Method | Description |
| --- | --- | --- |
| `reports.run` | POST | Run a standard report |
| `reports.batchRun` | POST | Run multiple reports in one request |
| `reports.realtime` | POST | Run a realtime report (cached 30 s) |
| `reports.pivot` | POST | Run a pivot report |
| `reports.funnel` | POST | Run a funnel report |
| `metadata.get` | GET | Available dimensions and metrics for a property |

## Common metrics

| Metric | Description |
| --- | --- |
| `activeUsers` | Users with engaged sessions |
| `sessions` | Total sessions |
| `screenPageViews` | Page view count |
| `bounceRate` | Single-page session rate |
| `averageSessionDuration` | Average session length |

## Rate limits

600 requests/min, 10 requests/s, tracked per artifact. Quota is enforced by
Google; a `GA_ERROR_429` means the property's daily token quota was reached.

## Errors

| Code | Meaning |
| --- | --- |
| `GA_NOT_CONNECTED` | Connector missing or credentials invalid |
| `GA_ACCESS_DENIED` | Property not accessible with the service account |
| `MISSING_PROPERTY_ID` | `propertyId` was not supplied |
| `GA_ERROR_429` | API quota exceeded |
