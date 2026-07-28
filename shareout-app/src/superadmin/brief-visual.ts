import type { DailyPlatformDigest } from './digest';
import { colors } from '../design-system/tokens';

function briefStyles(): string {
  const bg = colors.text;
  const surface = `color-mix(in srgb, ${colors.text} 88%, ${colors.bgElevated})`;
  const border = `color-mix(in srgb, ${colors.text} 72%, ${colors.borderStrong})`;
  const borderSoft = `color-mix(in srgb, ${colors.text} 80%, ${colors.border})`;
  const text = colors.bgElevated;
  const textSecondary = `color-mix(in srgb, ${colors.textTertiary} 55%, ${colors.bgElevated})`;
  const textMuted = colors.textTertiary;
  const accent = `color-mix(in srgb, ${colors.primary} 70%, white)`;
  const accentDeep = colors.primaryHover;
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${bg}; color: ${text}; width: 920px; padding: 28px; }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
  .sub { color: ${textSecondary}; font-size: 13px; margin-bottom: 20px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .kpi { background: ${surface}; border: 1px solid ${border}; border-radius: 10px; padding: 14px; }
  .kpi .v { font-size: 26px; font-weight: 700; color: ${accent}; }
  .kpi .l { font-size: 11px; color: ${textSecondary}; text-transform: uppercase; letter-spacing: .04em; margin-top: 4px; }
  .kpi .d { font-size: 12px; color: ${colors.success}; margin-top: 2px; }
  .kpi .d.neg { color: ${colors.error}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .card { background: ${surface}; border: 1px solid ${border}; border-radius: 10px; padding: 16px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: ${textSecondary}; margin-bottom: 12px; }
  .row { display: grid; grid-template-columns: 110px 1fr 36px; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; }
  .label { color: ${textSecondary}; }
  .track { height: 10px; background: ${border}; border-radius: 5px; overflow: hidden; }
  .fill { height: 100%; background: linear-gradient(90deg, ${accentDeep}, ${accent}); border-radius: 5px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; color: ${text}; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: ${textSecondary}; font-weight: 500; padding: 6px 8px; border-bottom: 1px solid ${border}; }
  td { padding: 6px 8px; border-bottom: 1px solid ${borderSoft}; font-variant-numeric: tabular-nums; }
  .muted { color: ${textMuted}; }
  .health { display: flex; gap: 20px; font-size: 13px; flex-wrap: wrap; }
  .health span { font-variant-numeric: tabular-nums; }
  .warn { color: ${colors.warning}; }
  .kpis--compact { margin-bottom: 0; }
  .health--spaced { margin-top: 14px; }`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function delta(curr: number, prev: number): string {
  const d = curr - prev;
  if (d === 0) return '—';
  return d > 0 ? `+${d}` : String(d);
}

function barPct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

/** Self-contained dashboard HTML for headless screenshot (CEO daily brief). */
export function buildBriefDashboardHtml(d: DailyPlatformDigest): string {
  const g = d.growth;
  const v = d.vsPriorDay;
  const growthMax = Math.max(g.newUsers, g.newArtifacts, g.versionPublishes, v.newUsers, v.newArtifacts, 1);
  const funnelSteps = d.marketing.personal.steps;
  const funnelMax = Math.max(...funnelSteps.map((s) => s.count), 1);
  const wsRows = d.workspaces.active.slice(0, 6);
  const topArt = d.productUsage.topArtifacts.slice(0, 5);

  const funnelBars = funnelSteps
    .map(
      (s) => `
    <div class="row">
      <div class="label">${esc(s.label)}</div>
      <div class="track"><div class="fill" style="width:${barPct(s.count, funnelMax)}%"></div></div>
      <div class="num">${s.count}</div>
    </div>`
    )
    .join('');

  const wsTable = wsRows.length
    ? wsRows
        .map(
          (w) =>
            `<tr><td>${esc(w.name)}</td><td>${w.newMembers}</td><td>${w.publishes}</td><td>${w.logins}</td><td>${w.aiTokens}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No workspace activity</td></tr>';

  const artRows = topArt.length
    ? topArt.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.workspace || '—')}</td><td>${a.views}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">No views</td></tr>';

  const tokenWs = d.economics.tokenByWorkspace.slice(0, 8);
  const wsTokenRows = tokenWs.length
    ? tokenWs
        .map(
          (w) =>
            `<tr><td>${esc(w.name)}</td><td>${w.tokens.toLocaleString()}</td><td>$${w.costUsd.toFixed(2)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="muted">No token usage</td></tr>';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${briefStyles()}</style></head><body>
  <h1>ShareOut CEO Brief</h1>
  <div class="sub">${esc(d.reportDate)} · ${d.totals.users} users · ${d.totals.artifacts} artifacts · ${d.totals.workspaces} workspaces</div>
  <div class="kpis">
    <div class="kpi"><div class="v">${g.newUsers}</div><div class="l">New users</div><div class="d">${delta(g.newUsers, v.newUsers)} vs prior</div></div>
    <div class="kpi"><div class="v">${g.versionPublishes}</div><div class="l">Publishes</div><div class="d">${delta(g.newArtifacts, v.newArtifacts)} artifacts</div></div>
    <div class="kpi"><div class="v">${g.logins}</div><div class="l">Logins</div><div class="d">${delta(g.logins, v.logins)} vs prior</div></div>
    <div class="kpi"><div class="v">${d.productUsage.artifactViews}</div><div class="l">Page views</div><div class="d">${d.productUsage.uniqueVisitors} visitors</div></div>
  </div>
  <div class="grid">
    <div class="card"><h2>Marketing funnel</h2>${funnelBars}</div>
    <div class="card"><h2>Growth vs prior day</h2>
      <div class="row"><div class="label">Users</div><div class="track"><div class="fill" style="width:${barPct(g.newUsers, growthMax)}%"></div></div><div class="num">${g.newUsers}</div></div>
      <div class="row"><div class="label">Artifacts</div><div class="track"><div class="fill" style="width:${barPct(g.newArtifacts, growthMax)}%"></div></div><div class="num">${g.newArtifacts}</div></div>
      <div class="row"><div class="label">Publishes</div><div class="track"><div class="fill" style="width:${barPct(g.versionPublishes, growthMax)}%"></div></div><div class="num">${g.versionPublishes}</div></div>
      <div class="row"><div class="label">Landing views</div><div class="track"><div class="fill" style="width:${barPct(d.marketing.personal.views, Math.max(d.marketing.personal.views, v.landingViews, 1))}%"></div></div><div class="num">${d.marketing.personal.views}</div></div>
    </div>
  </div>
  <div class="grid">
    <div class="card"><h2>Workspaces</h2><table><thead><tr><th>Name</th><th>+Members</th><th>Pub</th><th>Login</th><th>AI tok</th></tr></thead><tbody>${wsTable}</tbody></table></div>
    <div class="card"><h2>Top artifacts</h2><table><thead><tr><th>Name</th><th>Workspace</th><th>Views</th></tr></thead><tbody>${artRows}</tbody></table></div>
  </div>
  <div class="card"><h2>Daily spend</h2>
    <div class="kpis kpis--compact">
      <div class="kpi"><div class="v">$${d.economics.aiCostUsd.toFixed(2)}</div><div class="l">Tokens (LLM)</div><div class="d">${d.economics.aiTokens.toLocaleString()} tok</div></div>
      <div class="kpi"><div class="v">${d.economics.cloudflareAvailable ? '$' + d.economics.cloudflareUsd.toFixed(2) : 'n/a'}</div><div class="l">Cloudflare</div><div class="d">${d.economics.cloudflareAvailable ? 'infra est.' : 'not configured'}</div></div>
      <div class="kpi"><div class="v">$${d.economics.totalSpendUsd.toFixed(2)}</div><div class="l">Total spend</div><div class="d">${d.economics.cloudflareAvailable ? 'tokens + infra' : 'tokens only'}</div></div>
      <div class="kpi"><div class="v">$${d.economics.aiRevenueUsd.toFixed(2)}</div><div class="l">AI revenue</div><div class="d">$${d.economics.outstandingBalanceUsd.toFixed(2)} prepaid</div></div>
    </div>
    <div class="health health--spaced">
      <span class="muted">Month-to-date:</span>
      <span>tokens $${d.economics.mtd.aiCostUsd.toFixed(2)}</span>
      <span>cloudflare ${d.economics.mtd.cloudflareAvailable ? '$' + d.economics.mtd.cloudflareUsd.toFixed(2) : 'n/a'}</span>
      <span><strong>total $${d.economics.mtd.totalSpendUsd.toFixed(2)}</strong></span>
    </div>
  </div>
  <div class="card"><h2>Tokens by workspace · ${esc(d.reportDate)}</h2>
    <table><thead><tr><th>Workspace</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>${wsTokenRows}</tbody></table>
  </div>
  <div class="card"><h2>Platform health</h2>
    <div class="health">
      <span>${d.health.requests.toLocaleString()} reqs</span>
      <span class="${d.health.errorRatePct > 1 ? 'warn' : ''}">${d.health.errorRatePct.toFixed(2)}% err</span>
      <span>${d.health.status5xx} 5xx</span>
      <span>${Math.round(d.health.avgMs)}ms avg</span>
      <span>AI $${d.economics.aiRevenueUsd.toFixed(2)} rev</span>
      <span>$${d.economics.outstandingBalanceUsd.toFixed(2)} prepaid</span>
    </div>
  </div>
</body></html>`;
}

/** Compact monospace tables — Telegram fallback when screenshot unavailable. */
export function formatBriefTables(d: DailyPlatformDigest): string {
  const g = d.growth;
  const v = d.vsPriorDay;
  const lines = [
    `📊 ShareOut · ${d.reportDate}`,
    '',
    'GROWTH          today   Δ prior',
    `users           ${pad(g.newUsers)}   ${delta(g.newUsers, v.newUsers)}`,
    `artifacts       ${pad(g.newArtifacts)}   ${delta(g.newArtifacts, v.newArtifacts)}`,
    `publishes       ${pad(g.versionPublishes)}`,
    `logins          ${pad(g.logins)}   ${delta(g.logins, v.logins)}`,
    `ws invites      ${pad(g.newWorkspaceMembers)}`,
    '',
    'PRODUCT',
    `views           ${pad(d.productUsage.artifactViews)}  (${d.productUsage.uniqueVisitors} uniq)`,
    `crew runs       ${pad(d.productUsage.crewRuns)}`,
    '',
    'SPEND (USD)     today    MTD',
    `tokens (LLM)    $${d.economics.aiCostUsd.toFixed(2).padStart(6)}  $${d.economics.mtd.aiCostUsd.toFixed(2)}`,
    `cloudflare      ${(d.economics.cloudflareAvailable ? '$' + d.economics.cloudflareUsd.toFixed(2) : 'n/a').padStart(6)}  ${d.economics.mtd.cloudflareAvailable ? '$' + d.economics.mtd.cloudflareUsd.toFixed(2) : 'n/a'}`,
    `total           $${d.economics.totalSpendUsd.toFixed(2).padStart(6)}  $${d.economics.mtd.totalSpendUsd.toFixed(2)}`,
    `ai revenue      $${d.economics.aiRevenueUsd.toFixed(2)}`,
    ...(d.economics.tokenByWorkspace.length
      ? ['', 'TOKENS BY WORKSPACE', ...d.economics.tokenByWorkspace.slice(0, 8).map(
          (w) => `${w.name.slice(0, 14).padEnd(14)} ${w.tokens.toLocaleString().padStart(9)}  $${w.costUsd.toFixed(2)}`
        )]
      : []),
    '',
    'MARKETING',
    `landing views   ${pad(d.marketing.personal.views)}   ${delta(d.marketing.personal.views, v.landingViews)}`,
    `submit rate     ${d.marketing.personal.conversionPct.toFixed(1)}%`,
    `sessions        ${pad(d.marketing.uniqueSessions)}`,
    '',
    'HEALTH',
    `requests        ${pad(d.health.requests)}`,
    `error rate      ${d.health.errorRatePct.toFixed(2)}%`,
    `5xx / exc       ${d.health.status5xx} / ${d.health.exceptions}`,
  ];
  if (d.workspaces.active.length) {
    lines.push('', 'WORKSPACES (members·pub·login)');
    for (const w of d.workspaces.active.slice(0, 6)) {
      lines.push(`${w.name.slice(0, 14).padEnd(14)} ${w.newMembers}·${w.publishes}·${w.logins}`);
    }
  }
  return lines.join('\n');
}

function pad(n: number): string {
  return String(n).padStart(5);
}
