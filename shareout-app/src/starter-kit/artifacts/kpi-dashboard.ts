import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = '<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>';

const body = `
<div id="stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px"></div>
<div class="so-card">
  <h2>Last 7 days</h2>
  <div id="chart" style="width:100%;height:300px"></div>
</div>
<p class="so-muted" style="margin-top:16px">
  These stat cards and the chart read live from your own <code>so.table('metrics')</code> —
  the same numbers you could pipe in from a connected source. Edit a row and the dashboard
  follows. It's a real view of your data, not a static screenshot.
</p>`;

const script = `
  const metrics = so.table('metrics');

  if (await metrics.count() === 0) {
    const today = new Date();
    const seed = [
      { label: 'Mon', signups: 18, active: 142, revenue: 320 },
      { label: 'Tue', signups: 24, active: 158, revenue: 410 },
      { label: 'Wed', signups: 21, active: 165, revenue: 385 },
      { label: 'Thu', signups: 30, active: 171, revenue: 520 },
      { label: 'Fri', signups: 27, active: 180, revenue: 470 },
      { label: 'Sat', signups: 15, active: 149, revenue: 260 },
      { label: 'Sun', signups: 19, active: 155, revenue: 310 }
    ];
    for (let i = 0; i < seed.length; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (seed.length - 1 - i));
      const day = d.toISOString().slice(0, 10);
      await metrics.insert({
        date: day,
        label: seed[i].label,
        signups: seed[i].signups,
        active: seed[i].active,
        revenue: seed[i].revenue,
        created_at: Date.now() + i
      });
    }
  }

  const rows = await metrics.find().sort('date', 'asc').limit(30).exec();

  function statCard(value, label) {
    const card = document.createElement('div');
    card.className = 'so-card';
    card.style.padding = '16px 18px';
    const num = document.createElement('div');
    num.style.fontSize = '26px';
    num.style.fontWeight = '700';
    num.style.letterSpacing = '-.02em';
    num.textContent = value;
    const lab = document.createElement('div');
    lab.className = 'so-muted';
    lab.style.marginTop = '2px';
    lab.textContent = label;
    card.appendChild(num);
    card.appendChild(lab);
    return card;
  }

  const totalSignups = rows.reduce(function(s, r){ return s + (Number(r.signups) || 0); }, 0);
  const lastActive = rows.length ? (Number(rows[rows.length - 1].active) || 0) : 0;
  const totalRevenue = rows.reduce(function(s, r){ return s + (Number(r.revenue) || 0); }, 0);

  const stats = document.getElementById('stats');
  stats.appendChild(statCard(String(totalSignups), 'Signups'));
  stats.appendChild(statCard(String(lastActive), 'Active now'));
  stats.appendChild(statCard('$' + totalRevenue.toLocaleString(), 'Revenue'));

  const labels = rows.map(function(r){ return r.label || r.date; });
  const signupSeries = rows.map(function(r){ return Number(r.signups) || 0; });

  Plotly.newPlot('chart', [{
    type: 'bar',
    x: labels,
    y: signupSeries,
    marker: { color: '#2563eb' },
    hovertemplate: '%{x}: %{y} signups<extra></extra>'
  }], {
    margin: { t: 8, r: 8, b: 36, l: 36 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#57534e', size: 12 },
    xaxis: { fixedrange: true },
    yaxis: { fixedrange: true, gridcolor: '#e7e5e4', zeroline: false }
  }, { displayModeBar: false, responsive: true });`;

export const kpiDashboard: StarterArtifact = {
  slug: 'kpi-dashboard',
  name: 'KPI dashboard',
  description: 'Stat cards and a 7-day chart that read live from your own table.',
  feature: 'dashboards + charts',
  tier: 'personal',
  html: frame({
    title: 'KPI dashboard',
    feature: 'dashboards + charts',
    description: 'Three stat cards over a 7-day trend, all from so.table.',
    head,
    body,
    script,
  }),
};
