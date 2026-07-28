import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = `
<style>
.lc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:14px}
.lc-conn{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border:1px solid var(--so-border);
  border-radius:12px;background:var(--so-surface)}
.lc-logo{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;font-weight:700;
  font-size:13px;color:#fff}
.lc-name{font-weight:650;font-size:14px}
.lc-add{font-size:12px;color:var(--so-ink-3)}
.lc-snip{margin-top:14px;background:#1c1917;color:#e7e5e4;border-radius:12px;padding:14px 16px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;overflow-x:auto;white-space:pre}
</style>`;

const body = `
<div class="so-card">
  <h2>Connected data sources</h2>
  <p class="so-muted">Connectors live at the workspace level. A workspace admin adds one with their own
  credentials, then every artifact can read from it. None are wired up yet — here is what fits.</p>
  <div class="lc-grid" id="conns"></div>
  <p class="lc-add" style="margin-top:14px">Add or manage these in <strong>workspace settings → Connectors</strong>.</p>
</div>

<div class="so-card" style="margin-top:20px">
  <h2>Query it from any artifact</h2>
  <p class="so-muted">Once a connector named <code>sales</code> exists, reading live data is one call:</p>
  <div class="lc-snip" id="snippet"></div>
</div>

<p class="so-muted" style="margin-top:18px">
  Connect your warehouse or SaaS once at the workspace level — you paste your own credentials, they
  stay there. After that any artifact can pull live data with <code>so.connection</code>, so a
  dashboard reads straight from the source instead of a stale export you have to refresh by hand.
</p>`;

const script = `
  const connectors = [
    { name: 'Google Sheets', color: '#0f9d58', mark: 'GS' },
    { name: 'BigQuery',      color: '#4285f4', mark: 'BQ' },
    { name: 'Snowflake',     color: '#29b5e8', mark: 'SF' },
    { name: 'Shopify',       color: '#5e8e3e', mark: 'SH' },
    { name: 'Postgres',      color: '#336791', mark: 'PG' },
    { name: 'REST API',      color: '#57534e', mark: 'API' }
  ];

  const grid = document.getElementById('conns');
  connectors.forEach(function(c){
    const cell = document.createElement('div');
    cell.className = 'lc-conn';
    const logo = document.createElement('div');
    logo.className = 'lc-logo';
    logo.style.background = c.color;
    logo.textContent = c.mark;
    const name = document.createElement('div');
    name.className = 'lc-name';
    name.textContent = c.name;
    const add = document.createElement('div');
    add.className = 'lc-add';
    add.textContent = 'Add in workspace settings';
    cell.appendChild(logo);
    cell.appendChild(name);
    cell.appendChild(add);
    grid.appendChild(cell);
  });

  const lines = [
    "const sales = so.connection('sales');",
    "const { data } = await sales.query(",
    "  'SELECT region, SUM(total) AS revenue FROM orders GROUP BY region'",
    ");",
    "// data is an array of rows — render it however you like"
  ];
  document.getElementById('snippet').textContent = lines.join('\\n');`;

export const liveConnector: StarterArtifact = {
  slug: 'live-connector',
  name: 'Live connector',
  description: 'Connect a warehouse or SaaS once, then read live data from any artifact.',
  feature: 'connectors',
  tier: 'team',
  html: frame({
    title: 'Live connector',
    feature: 'connectors',
    description: 'Read live data from your warehouse or SaaS with a workspace connection.',
    head,
    body,
    script,
  }),
};
