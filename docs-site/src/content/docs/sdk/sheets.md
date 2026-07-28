---
title: Sheets store
description: Read from and write to Google Sheets via OAuth, with built-in caching and connection management.
---

import { Aside } from '@astrojs/starlight/components';

Read from and write to Google Spreadsheets inside an artifact via OAuth. Access via `sdk.sheets`. See [Google Sheets integration](/integrations/google-sheets/) for a full setup guide.

## Methods

```typescript
// OAuth
isConnected(): Promise<boolean>
authorize(returnUrl?: string): Promise<boolean>     // opens OAuth popup
getAuthUrl(returnUrl?: string): Promise<{ authUrl: string; message: string }>
status(): Promise<SheetsStatus>
connect(returnUrl?: string): void                    // full-page redirect
disconnect(): Promise<void>

// Read
fetch<T>(options: FetchOptions): Promise<FetchResult<T>>
refresh<T>(options: FetchOptions): Promise<FetchResult<T>>  // bypass cache

// Write (owner only)
update(options: UpdateOptions): Promise<{ updated: boolean; updatedCells: number; updatedRows: number }>
append(options: AppendOptions): Promise<{ appended: boolean; appendedRows: number; appendedCells: number }>

// Connection management (named connections with sync)
list(): Promise<SheetConnection[]>
get(name: string): Promise<SheetConnection | null>
create(options: ConnectionOptions): Promise<SheetConnection>
delete(name: string): Promise<boolean>
import(connectionName: string): Promise<{ imported: number; targetTable: string; columns: string[] }>
export(connectionName: string): Promise<{ exported: number; spreadsheetId: string; columns: string[] }>

// Cache
cacheStatus(): Promise<{ caches: Array<{ key: string; cachedAt: string; rowCount: number }>; count: number }>
clearCache(spreadsheetId?: string): Promise<{ cleared: boolean }>
```

```typescript
interface FetchOptions {
  spreadsheetUrl?: string;   // full Google Sheets URL  (one of the two required)
  spreadsheetId?: string;    // spreadsheet ID
  range?: string;            // sheet name or A1 range
  headers?: boolean;         // first row as column names (default: false)
  cache?: boolean;           // use 5-min cache (default: true)
  forceRefresh?: boolean;
}

interface FetchResult<T> {
  data: T[];
  headers?: string[];
  rowCount: number;
  cached?: boolean;
  cachedAt?: string;
}

interface ConnectionOptions {
  name: string;
  spreadsheetId: string;
  sheetName?: string;
  targetTable: string;
  syncDirection?: 'import' | 'export' | 'bidirectional';
  syncSchedule?: string;
}
```

## Examples

### Fetch data (quick flow)

```javascript
const sdk = await ShareOut.create();

if (!await sdk.sheets.isConnected()) {
  const ok = await sdk.sheets.authorize();
  if (!ok) return;
}

const { data, headers, rowCount } = await sdk.sheets.fetch({
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/ABC123/edit',
  range: 'Sheet1',
  headers: true,
});

// data = [{ Name: 'Alice', Score: 95 }, ...]
```

### Append rows (owner)

```javascript
await sdk.sheets.append({
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/ABC123/edit',
  range: 'Sheet1',
  values: [['Alice', 95], ['Bob', 87]],
});
```

### Update a range (owner)

```javascript
await sdk.sheets.update({
  spreadsheetId: 'ABC123',
  range: 'Sheet1!B2',
  values: [[99]],
});
```

### Named connection with table sync

```javascript
// Create a connection that imports data into a ShareOut table
await sdk.sheets.create({
  name: 'sales-sheet',
  spreadsheetId: 'ABC123',
  sheetName: 'Sales',
  targetTable: 'sales',
  syncDirection: 'import',
});

// Trigger an import
const { imported } = await sdk.sheets.import('sales-sheet');
console.log(`Imported ${imported} rows`);
```

### Refresh cache

```javascript
// Force fresh data, bypassing the 5-min cache
const fresh = await sdk.sheets.refresh({
  spreadsheetId: 'ABC123',
  headers: true,
});
```

## Errors

| Code | Status | Description |
|------|--------|-------------|
| `SHEETS_NOT_CONNECTED` | 401 | OAuth not completed |
| `SHEETS_ACCESS_DENIED` | 403 | Sheet not shared with the account |
| `FETCH_ERROR` | 500 | Google Sheets API error |

<Aside type="note">
`fetch()` caches results for 5 minutes by default to reduce API calls. Use `refresh()` or `forceRefresh: true` when you need live data. Write methods (`update`, `append`) require artifact owner authentication.
</Aside>
