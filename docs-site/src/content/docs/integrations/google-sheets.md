---
title: Google Sheets
description: Read spreadsheet data into your artifact with OAuth.
---

Pull rows from a Google Sheet straight into your page. Access via `sdk.sheets`.

## Quick start

```javascript
const sdk = await ShareOut.create();

if (!await sdk.sheets.isConnected()) {
  const ok = await sdk.sheets.authorize();   // opens OAuth popup
  if (!ok) return;
}

const { data, headers, rowCount } = await sdk.sheets.fetch({
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/ABC123/edit',
  range: 'Sheet1',
  headers: true,
});
```

## Methods

```typescript
getAuthUrl(returnUrl?): Promise<{ authUrl, message }>
authorize(returnUrl?): Promise<boolean>
isConnected(): Promise<boolean>
fetch({ spreadsheetUrl?, spreadsheetId?, range?, headers? }): Promise<{ data, headers?, rowCount }>
```

Pass either `spreadsheetUrl` or `spreadsheetId`. With `headers: true`, each row
becomes an object keyed by the first row's column names.

## Cache the result

Fetch once, store in `sdk.json`, and render from there so navigation doesn't
refetch:

```javascript
const { data } = await sdk.sheets.fetch({ spreadsheetId: 'ID', range: 'Data!A1:Z100', headers: true });
await sdk.json.set('sheetsData', { data, fetchedAt: Date.now() });
```

## Errors

| Code | Meaning |
| --- | --- |
| `SHEETS_NOT_CONNECTED` | OAuth not completed — call `authorize()` |
| `SHEETS_ACCESS_DENIED` | The sheet isn't shared with the connected account |
| `FETCH_ERROR` | Google Sheets API error |

## Stale-data monitoring

When a page uses a **Google Sheets** connection, ShareOut records `last_synced_at`
on each sync. An hourly sweep flags connections that haven't synced in **7+ days**
and drops a **Stale data** card in the bell (and includes them in the [weekly
workspace digest](/everyone/your-workspace/#weekly-workspace-digest)). Re-notifies
at most once per week while still stale. Open the page and re-sync (or fix the
connection) to clear the condition.

Other Data Platform connectors (Snowflake, GA, Shopify, etc.) are live-query
proxies with no sync timestamp — this sentinel applies to Sheets only today.
