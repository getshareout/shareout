# Integration: Google Analytics

GA4 reports and metrics via Data Platform.

## Quick Start

```javascript
const sdk = new ShareOut();

// Check connection
if (!await sdk.analytics.isConnected()) {
  await sdk.analytics.authorize();
}

// Fetch metrics
const { data } = await sdk.analytics.fetch({
  propertyId: '123456789',
  metrics: ['activeUsers', 'sessions', 'pageviews'],
  dimensions: ['date'],
  dateRange: { start: '7daysAgo', end: 'today' }
});
```

## SDK Methods

```typescript
// Get OAuth URL
getAuthUrl(returnUrl?: string): Promise<{ authUrl: string }>

// Open OAuth popup
authorize(returnUrl?: string): Promise<boolean>

// Check connection status
isConnected(): Promise<boolean>

// Fetch report data
fetch(options: GAFetchOptions): Promise<GAResponse>
```

## Fetch Options

| Field | Required | Description |
|-------|----------|-------------|
| `propertyId` | Yes | GA4 property ID |
| `metrics` | Yes | Metrics to fetch |
| `dimensions` | No | Dimensions for grouping |
| `dateRange` | No | Date range (default: 28 days) |

## Common Metrics

| Metric | Description |
|--------|-------------|
| `activeUsers` | Users with engaged sessions |
| `sessions` | Total sessions |
| `pageviews` | Page view count |
| `bounceRate` | Single-page session rate |
| `averageSessionDuration` | Avg session length |

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `GA_NOT_CONNECTED` | 401 | OAuth not completed |
| `GA_ACCESS_DENIED` | 403 | Property not accessible |
| `GA_QUOTA_EXCEEDED` | 429 | API quota limit |

## Related

- [Overview](overview.md) - All integrations
- [Google Sheets](google-sheets.md) - Sheets integration
