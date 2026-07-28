# Pattern: Dashboards

Copy-paste patterns for dashboard layouts.

> **Live Mixpanel / BigQuery / workspace REST connections:** use `ShareOut.create()` and
> SDK APIs — not raw `fetch`. See [../sdk/live-data.md](../sdk/live-data.md).
>
> **Render fast (no blank screen):** read first-paint data from `sdk.json`/`sdk.table()` (prefetched, instant) and precompute live warehouse queries into a snapshot — don't `connection.query()` on load. See [performance.md](performance.md).

## Metric Cards

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": {
      "metrics": { "default": { "users": 0, "revenue": 0, "orders": 0 } }
    }
  }
}
</script>

<div class="metrics-grid">
  <div class="metric-card">
    <span class="label">Users</span>
    <span class="value" data-shareout-binding="json:metrics.users"></span>
  </div>
  <div class="metric-card">
    <span class="label">Revenue</span>
    <span class="value" data-shareout-binding="json:metrics.revenue"
          data-shareout-format="currency:USD"></span>
  </div>
  <div class="metric-card">
    <span class="label">Orders</span>
    <span class="value" data-shareout-binding="json:metrics.orders"></span>
  </div>
</div>

<style>
  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
  .metric-card { padding: 1.5rem; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .label { font-size: 0.875rem; color: #666; }
  .value { font-size: 2rem; font-weight: bold; display: block; }
</style>
```

## Followable KPIs (Metric Alerts)

Make a KPI *followable* so owners and viewers can be alerted when it crosses a
threshold (see [../api/metric-alerts.md](../api/metric-alerts.md)). Two steps:

1. **Write the KPI value to `sdk.json`** so the visible card and the server-side
   alert evaluator share the same number. Don't compute the headline number only
   in client JS — persist it.
2. **Declare the followable metric** — easiest is a `<script type="shareout/metrics">`
   block in the page; on publish it's parsed and the metric definitions are
   registered automatically (no API call). You can also `PUT /v1/metric-alerts/definitions`.

```html
<div class="metric-card" data-shareout-metric-id="revenue">
  <span class="label">Revenue</span>
  <span class="value" data-shareout-binding="json:metrics.revenue"
        data-shareout-format="currency:USD"></span>
</div>

<!-- Declared followable metrics — registered automatically on publish. -->
<script type="shareout/metrics">
{
  "metrics": [
    { "id": "revenue", "label": "Revenue", "format": "currency:USD",
      "source": { "type": "json_path", "key": "metrics", "path": "$.revenue" } }
  ]
}
</script>

<script type="module">
  import { ShareOut } from '$ORIGIN/sdk/shareout.js';
  const sdk = await ShareOut.create();
  // Persist the headline number the dashboard shows.
  await sdk.json.set('metrics', { revenue: 92420, signups: 1240 });
</script>
```

Publish-time parsing is **upsert-only**: declared metrics are created/updated;
removing one from the HTML doesn't delete it (delete via the editor or
`DELETE /v1/metric-alerts/definitions/...`). The `data-shareout-metric-id`
attribute is an optional hint for future in-product UI highlighting; the alert
reads the stored `metrics.revenue` value via the definition's `source`.

### One-click metric watches (simpler)

For table-backed dashboards, owners can add a **metric watch** (Inspector **Watches** or `POST /v1/metric-watch`) — row count, column sum, or last value — and get a **bell** when the number moves ≥20% (configurable). No Slack/email setup. See [../api/metric-watch.md](../api/metric-watch.md). Use [metric alerts](../api/metric-alerts.md) when you need destinations, cron schedules, or json-path KPIs.

## Chart Dashboard

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": { "chartData": { "default": [] } }
  }
}
</script>

<div class="dashboard">
  <div class="chart-container">
    <canvas data-shareout-binding="json:chartData"
            data-shareout-chart="line"
            data-shareout-options='{"responsive": true}'></canvas>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
  const sdk = new ShareOut();

  async function refreshData() {
    const data = await fetchFromAPI();
    await sdk.json.set('chartData', data);
  }
</script>
```

## Filter Bar

```html
<div class="filter-bar">
  <select data-shareout-binding="json:filters.dateRange" onchange="applyFilters()">
    <option value="7d">Last 7 days</option>
    <option value="30d">Last 30 days</option>
    <option value="90d">Last 90 days</option>
  </select>
  <input type="search" placeholder="Search..."
         data-shareout-binding="json:filters.search"
         oninput="debounceSearch(this.value)">
</div>
```

## Google Sheets Dashboard

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": { "sheetsData": { "default": null } }
  }
}
</script>

<div id="connect-section" style="display:none">
  <button onclick="connectSheets()">Connect Google Sheets</button>
</div>

<div id="dashboard" style="display:none">
  <table data-shareout-binding="json:sheetsData"></table>
</div>

<script>
  const sdk = new ShareOut();

  async function init() {
    if (await sdk.sheets.isConnected()) {
      loadData();
    } else {
      document.getElementById('connect-section').style.display = 'block';
    }
  }

  async function connectSheets() {
    await sdk.sheets.authorize();
    loadData();
  }

  async function loadData() {
    const { data } = await sdk.sheets.fetch({
      spreadsheetId: 'YOUR_ID',
      range: 'Data!A1:Z100',
      headers: true
    });
    await sdk.json.set('sheetsData', data);
    document.getElementById('connect-section').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
  }

  init();
</script>
```

## Related

- [Overview](overview.md) - All patterns
- [SDK: Live data](../sdk/live-data.md) - Mixpanel, BigQuery, REST connections in artifacts
- [Modules: Dashboards](../modules/dashboards/overview.md) - Dashboard module
- [Google Sheets](../integrations/google-sheets.md) - Sheets integration
