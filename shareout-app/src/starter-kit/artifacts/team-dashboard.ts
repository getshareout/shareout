import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = '<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>';

const body = `
<div class="so-card">
  <h2>This week</h2>
  <div id="kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
    <p class="so-muted">Loading…</p>
  </div>
</div>
<div class="so-card" style="margin-top:16px">
  <h2>Trend</h2>
  <div id="chart" style="width:100%;height:300px"></div>
</div>
<p class="so-muted" style="margin-top:16px">
  This is a shared scoreboard — everyone in the workspace sees the same numbers.
  On a Teams workspace it can read from shared workspace tables and connected data
  sources, so the whole team sees the same live figures on your workspace subdomain.
</p>`;

const script = `
  const metrics = so.table('team_metrics');

  if (await metrics.count() === 0) {
    const seed = [
      { week: 'May 5',  shipped: 7,  reviews: 12, uptime: 99.8 },
      { week: 'May 12', shipped: 9,  reviews: 15, uptime: 99.9 },
      { week: 'May 19', shipped: 6,  reviews: 11, uptime: 99.6 },
      { week: 'May 26', shipped: 11, reviews: 18, uptime: 100  },
      { week: 'Jun 2',  shipped: 10, reviews: 14, uptime: 99.9 },
      { week: 'Jun 9',  shipped: 13, reviews: 20, uptime: 99.95 }
    ];
    for (const r of seed) await metrics.insert(r);
  }

  const rows = await metrics.find().exec();

  const totalShipped = rows.reduce(function(s, r){ return s + (r.shipped || 0); }, 0);
  const totalReviews = rows.reduce(function(s, r){ return s + (r.reviews || 0); }, 0);
  const avgUptime = rows.length
    ? rows.reduce(function(s, r){ return s + (r.uptime || 0); }, 0) / rows.length
    : 0;
  const last = rows[rows.length - 1] || {};

  function kpi(label, value){
    const card = document.createElement('div');
    card.style.padding = '14px 16px';
    card.style.border = '1px solid var(--so-border)';
    card.style.borderRadius = '12px';
    card.style.background = 'var(--so-bg)';
    const v = document.createElement('div');
    v.style.fontSize = '26px';
    v.style.fontWeight = '700';
    v.style.letterSpacing = '-.02em';
    v.textContent = value;
    const l = document.createElement('div');
    l.className = 'so-muted';
    l.style.marginTop = '2px';
    l.textContent = label;
    card.appendChild(v); card.appendChild(l);
    return card;
  }

  const kpis = document.getElementById('kpis');
  kpis.innerHTML = '';
  kpis.appendChild(kpi('Shipped this week', String(last.shipped || 0)));
  kpis.appendChild(kpi('Reviews this week', String(last.reviews || 0)));
  kpis.appendChild(kpi('Avg uptime', avgUptime.toFixed(2) + '%'));
  kpis.appendChild(kpi('Shipped to date', String(totalShipped)));

  const weeks = rows.map(function(r){ return r.week; });
  const data = [
    {
      x: weeks,
      y: rows.map(function(r){ return r.shipped; }),
      name: 'Shipped',
      type: 'scatter',
      mode: 'lines+markers',
      line: { color: '#2563eb', width: 3 },
      marker: { color: '#2563eb', size: 7 }
    },
    {
      x: weeks,
      y: rows.map(function(r){ return r.reviews; }),
      name: 'Reviews',
      type: 'scatter',
      mode: 'lines+markers',
      line: { color: '#a8a29e', width: 2 },
      marker: { color: '#a8a29e', size: 6 }
    }
  ];
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#57534e', size: 12 },
    margin: { l: 36, r: 12, t: 8, b: 36 },
    legend: { orientation: 'h', y: -0.2 },
    xaxis: { showgrid: false },
    yaxis: { gridcolor: '#e7e5e4', zeroline: false }
  };
  Plotly.newPlot('chart', data, layout, { displayModeBar: false, responsive: true });
`;

export const teamDashboard: StarterArtifact = {
  slug: 'team-dashboard',
  name: 'Team dashboard',
  description: 'A shared scoreboard — KPIs and a trend chart the whole workspace sees.',
  feature: 'team dashboard',
  tier: 'team',
  html: frame({
    title: 'Team dashboard',
    feature: 'team dashboard',
    description: 'A shared scoreboard everyone in the workspace sees.',
    head,
    body,
    script,
  }),
};
