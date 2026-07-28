# Integration: Google Sheets

OAuth and data fetching from Google Spreadsheets.

## Quick Start

```javascript
const sdk = new ShareOut();

// Check connection
if (!await sdk.sheets.isConnected()) {
  const success = await sdk.sheets.authorize();
  if (!success) return;
}

// Fetch data
const { data, headers, rowCount } = await sdk.sheets.fetch({
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/ABC123/edit',
  range: 'Sheet1',
  headers: true
});
```

## SDK Methods

```typescript
// Get OAuth URL (for manual handling)
getAuthUrl(returnUrl?: string): Promise<{ authUrl: string; message: string }>

// Open OAuth popup and wait
authorize(returnUrl?: string): Promise<boolean>

// Check if connected
isConnected(): Promise<boolean>

// Fetch spreadsheet data
fetch<T>(options: {
  spreadsheetUrl?: string;
  spreadsheetId?: string;
  range?: string;
  headers?: boolean;
}): Promise<{ data: T[]; headers?: string[]; rowCount: number }>
```

## Fetch Options

| Field | Required | Description |
|-------|----------|-------------|
| `spreadsheetUrl` | Yes* | Full Google Sheets URL |
| `spreadsheetId` | Yes* | Spreadsheet ID (alternative) |
| `range` | No | Sheet name or A1 range |
| `headers` | No | First row as column names |

*Either `spreadsheetUrl` or `spreadsheetId` required.

## Response (headers=true)

```json
{
  "data": [
    { "Name": "Alice", "Score": 95 },
    { "Name": "Bob", "Score": 87 }
  ],
  "headers": ["Name", "Score"],
  "rowCount": 2
}
```

## Response (headers=false)

```json
{
  "data": [["Name", "Score"], ["Alice", "95"], ["Bob", "87"]],
  "rowCount": 3
}
```

## REST API

```http
GET  /v1/data/{artifactId}/sheets/auth-url
GET  /v1/data/{artifactId}/sheets/token-status
POST /v1/data/{artifactId}/sheets/fetch
```

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `SHEETS_NOT_CONNECTED` | 401 | OAuth not completed |
| `SHEETS_ACCESS_DENIED` | 403 | Sheet not shared |
| `FETCH_ERROR` | 500 | Google Sheets API error |

## Dashboard Pattern

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": { "sheetsData": { "default": null } }
  }
}
</script>
<script src="$ORIGIN/sdk/shareout.js"></script>
<script>
  const sdk = new ShareOut();

  async function loadData() {
    if (!await sdk.sheets.isConnected()) {
      document.getElementById('connect-btn').style.display = 'block';
      return;
    }

    const { data } = await sdk.sheets.fetch({
      spreadsheetId: 'YOUR_ID',
      range: 'Data!A1:Z100',
      headers: true
    });

    await sdk.json.set('sheetsData', { data, fetchedAt: Date.now() });
    renderDashboard(data);
  }

  document.getElementById('connect-btn').addEventListener('click', async () => {
    await sdk.sheets.authorize();
    loadData();
  });

  loadData();
</script>
```

## Scheduled Append (warehouse/connection → Sheet)

To **write a new dated row-set into a Google Sheet every day** (e.g. log daily revenue), use a `sheets_append` scheduled job. It runs one connection query and appends the rows to a connected sheet on the owner's token — no dashboard or browser session needed.

```json
{
  "artifact_id": "art_abc123",
  "action": "sheets_append",
  "trigger_type": "cron",
  "schedule": "0 12 * * *",
  "config": {
    "connection": "bigquery",
    "params": { "projectId": "my-gcp-project" },
    "query": "SELECT FORMAT_DATE('%Y-%m-%d', date) AS date, site, revenue FROM `my-gcp-project.analytics.daily` WHERE date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)",
    "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/1AbCdEf.../edit",
    "range": "Daily",
    "columns": ["date", "site", "revenue"]
  }
}
```

The owner must have Sheets connected and edit access to the spreadsheet; the target tab must already exist (header row appended once by you). See [api/jobs.md → SheetsAppendConfig](../api/jobs.md#sheetsappendconfig) for the full field reference. For browser-side writes from an open artifact, use `sdk.sheets.append()` / `sdk.sheets.update()` instead.

## Stale-data sentinel

Dashboards backed by a **Google Sheets sync** track `last_synced_at` per connection. A daily sweep flags connections that have not synced in **7+ days** and drops a **`stale_data`** row in **Needs You** (re-notifies at most once per 7 days while still stale). Fix by reconnecting or triggering a sync — live-query connectors (Snowflake, GA, etc.) are out of scope because they have no sync timestamp.

## Related

- [Overview](overview.md) - All integrations
- [Google Analytics](google-analytics.md) - GA4 integration
- [Scheduled Jobs](../api/jobs.md) - `sheets_append` and other delivery jobs
