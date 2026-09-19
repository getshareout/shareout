// Synthetic HTML for the investor-demo seed workspace. No customer data, no network
// calls, no CDN dependencies — every artifact is a self-contained index.html using the
// ShareOut warm-neutral palette (Design/visual/color.md) inlined as CSS custom
// properties, since a published artifact can't reach the app's own token package.

const BASE_STYLE = `
  :root {
    --color-bg: #FAFAF9;
    --color-surface: #F5F5F4;
    --color-elevated: #FFFFFF;
    --color-border: #E7E5E4;
    --color-text: #1C1917;
    --color-text-secondary: #57534E;
    --color-text-tertiary: #A8A29E;
    --color-primary: #2563EB;
    --color-primary-light: #EFF6FF;
    --color-success: #16A34A;
    --color-success-bg: #F0FDF4;
    --color-warning: #CA8A04;
    --color-warning-bg: #FEFCE8;
    --shadow-sm: 0 1px 2px rgba(28,25,23,0.04);
    --shadow-md: 0 2px 8px rgba(28,25,23,0.06);
    --radius-card: 16px;
    --radius-pill: 999px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--color-bg);
    color: var(--color-text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 40px 32px 64px;
  }
  header.page-head { margin-bottom: 32px; }
  header.page-head h1 { font-size: 28px; font-weight: 600; margin: 0 0 6px; }
  header.page-head p { color: var(--color-text-secondary); margin: 0; font-size: 15px; }
  .grid { display: grid; gap: 20px; }
  .kpis { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: 32px; }
  .card {
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-sm);
    padding: 20px 22px;
  }
  .kpi-label { font-size: 13px; color: var(--color-text-secondary); margin-bottom: 8px; }
  .kpi-value { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; }
  .kpi-delta { font-size: 13px; margin-top: 6px; }
  .kpi-delta.up { color: var(--color-success); }
  .kpi-delta.down { color: #DC2626; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: var(--color-text-secondary); font-weight: 500; padding: 10px 12px; border-bottom: 1px solid var(--color-border); }
  td { padding: 12px; border-bottom: 1px solid var(--color-border); }
  tr:last-child td { border-bottom: none; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: var(--radius-pill); font-size: 12px; font-weight: 500; }
  .pill.success { background: var(--color-success-bg); color: var(--color-success); }
  .pill.warning { background: var(--color-warning-bg); color: var(--color-warning); }
  .pill.info { background: var(--color-primary-light); color: var(--color-primary); }
  .bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .bar-label { width: 130px; font-size: 13px; color: var(--color-text-secondary); flex-shrink: 0; }
  .bar-track { flex: 1; background: var(--color-surface); border-radius: 8px; height: 22px; overflow: hidden; }
  .bar-fill { height: 100%; background: var(--color-primary); border-radius: 8px; }
  .bar-value { width: 56px; text-align: right; font-size: 13px; font-weight: 500; }
  section.card + section.card { margin-top: 20px; }
  h2 { font-size: 16px; font-weight: 600; margin: 0 0 16px; }
`;

function page(title, subtitle, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${BASE_STYLE}</style>
</head>
<body data-shareout-page="main">
<header class="page-head">
  <h1>${title}</h1>
  <p>${subtitle}</p>
</header>
${bodyHtml}
</body>
</html>`;
}

function kpiCard(label, value, delta, editable) {
  const deltaClass = delta.startsWith('-') ? 'down' : 'up';
  const valueAttr = editable ? ' data-shareout-editable="text"' : '';
  return `<div class="card">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value"${valueAttr}>${value}</div>
    <div class="kpi-delta ${deltaClass}">${delta} vs last quarter</div>
  </div>`;
}

export function revenueOverviewHtml() {
  const kpis = [
    kpiCard('Annual recurring revenue', '$4.82M', '+18%', true),
    kpiCard('New MRR this quarter', '$96K', '+9%', true),
    kpiCard('Net revenue retention', '128%', '+4pt', true),
    kpiCard('Gross churn', '1.4%', '-0.3pt', true),
  ].join('\n');

  const rows = [
    ['Enterprise', '$2.10M', '44%'],
    ['Mid-market', '$1.55M', '32%'],
    ['SMB', '$0.78M', '16%'],
    ['Self-serve', '$0.39M', '8%'],
  ]
    .map(([seg, amt, share]) => `<tr><td>${seg}</td><td>${amt}</td><td>${share}</td></tr>`)
    .join('\n');

  return page(
    'Revenue overview',
    'Synthetic demo data — quarterly revenue by segment.',
    `<div class="grid kpis">${kpis}</div>
<section class="card">
  <h2 data-shareout-editable="text">Revenue by segment</h2>
  <table>
    <thead><tr><th>Segment</th><th>ARR</th><th>Share</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`
  );
}

export function pipelineHealthHtml() {
  const stages = [
    ['Prospecting', 120, 100],
    ['Qualified', 74, 62],
    ['Proposal', 41, 34],
    ['Negotiation', 22, 18],
    ['Closed won', 13, 11],
  ];
  const maxWidth = 100;
  const bars = stages
    .map(([label, count, pct]) => `<div class="bar-row">
      <div class="bar-label">${label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((pct / maxWidth) * 100)}%"></div></div>
      <div class="bar-value">${count}</div>
    </div>`)
    .join('\n');

  const deals = [
    ['Northwind Robotics', '$182K', 'Negotiation', 'warning'],
    ['Bluebird Analytics', '$94K', 'Proposal', 'info'],
    ['Cedarline Retail', '$310K', 'Negotiation', 'warning'],
    ['Foothill Logistics', '$58K', 'Qualified', 'info'],
    ['Marrow Health', '$221K', 'Closed won', 'success'],
  ]
    .map(
      ([name, amt, stage, tone]) =>
        `<tr><td>${name}</td><td>${amt}</td><td><span class="pill ${tone}">${stage}</span></td></tr>`
    )
    .join('\n');

  return page(
    'Pipeline health',
    'Synthetic demo data — sales funnel and top open deals.',
    `<section class="card"><h2>Funnel</h2>${bars}</section>
<section class="card">
  <h2>Top deals</h2>
  <table>
    <thead><tr><th>Account</th><th>Value</th><th>Stage</th></tr></thead>
    <tbody>${deals}</tbody>
  </table>
</section>`
  );
}

export function supportQueueHtml() {
  const tickets = [
    ['#1042', 'Export button unresponsive on Safari', 'high', 'warning'],
    ['#1041', 'Feature request: dark mode for dashboards', 'low', 'info'],
    ['#1039', 'Slack digest arrived twice', 'medium', 'warning'],
    ['#1037', 'Onboarding checklist typo', 'low', 'info'],
    ['#1033', 'Billing question (resolved)', 'closed', 'success'],
  ]
    .map(
      ([id, title, sev, tone]) =>
        `<tr><td>${id}</td><td>${title}</td><td><span class="pill ${tone}">${sev}</span></td></tr>`
    )
    .join('\n');

  return page(
    'Support queue',
    'Synthetic demo data — open tickets, seeded with a comment thread for the demo.',
    `<section class="card">
  <h2>Open tickets</h2>
  <table>
    <thead><tr><th>ID</th><th>Summary</th><th>Severity</th></tr></thead>
    <tbody>${tickets}</tbody>
  </table>
</section>`
  );
}

export function usageTrendsHtml() {
  const points = [22, 28, 31, 27, 35, 41, 47, 44, 52, 58, 55, 63];
  const width = 640;
  const height = 160;
  const max = Math.max(...points);
  const stepX = width / (points.length - 1);
  const coords = points
    .map((v, i) => `${Math.round(i * stepX)},${Math.round(height - (v / max) * height)}`)
    .join(' ');

  return page(
    'Usage trends',
    'Synthetic demo data — weekly active workspaces, last 12 weeks.',
    `<div class="grid kpis">
  ${kpiCard('Weekly active workspaces', '63', '+14%', false)}
  ${kpiCard('Avg. artifacts per workspace', '7.2', '+2%', false)}
  ${kpiCard('7-day retention', '81%', '+3pt', false)}
</div>
<section class="card">
  <h2>Weekly active workspaces</h2>
  <svg viewBox="0 0 ${width} ${height}" width="100%" height="180" preserveAspectRatio="none">
    <polyline points="${coords}" fill="none" stroke="#2563EB" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</section>`
  );
}

export function teamDirectoryHtml() {
  const rows = [
    ['Ada Torres', 'Head of Data', 'ada@investor-demo.local'],
    ['Ben Ochieng', 'Support Lead', 'ben@investor-demo.local'],
    ['Casey Lindqvist', 'Sales Ops', 'casey@investor-demo.local'],
    ['Dara Whitfield', 'Product', 'dara@investor-demo.local'],
  ]
    .map(([name, role, email]) => `<tr><td>${name}</td><td>${role}</td><td>${email}</td></tr>`)
    .join('\n');

  return page(
    'Team directory',
    'Synthetic demo data — source table for the scheduled digest and crew.',
    `<section class="card">
  <table>
    <thead><tr><th>Name</th><th>Role</th><th>Email</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`
  );
}
