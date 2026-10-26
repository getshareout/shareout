/**
 * results/<ts>-<label>/summary.json + report.html, and comparison against a baseline.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BENCH_DIR, median, readJson, round, spread, writeJson } from './lib.mjs';

export const WEIGHTS = { judge: 0.35, functional: 0.25, runtime: 0.15, a11y: 0.15, layout: 0.1 };

export function quality(parts, gatesOk) {
  if (!gatesOk) return 0;
  let w = 0;
  let s = 0;
  for (const [k, weight] of Object.entries(WEIGHTS)) {
    if (typeof parts[k] !== 'number') continue;
    w += weight;
    s += weight * parts[k];
  }
  return w ? s / w : 0;
}

const METRICS = ['quality', 'judge', 'functional', 'runtime', 'a11y', 'layout', 'cost_usd', 'minutes', 'tokens', 'tool_calls', 'http_calls', 'publishes'];

export function aggregate(runs) {
  const byBrief = {};
  for (const r of runs) (byBrief[r.brief] ||= []).push(r);
  const briefs = {};
  for (const [id, rs] of Object.entries(byBrief)) {
    const row = { title: rs[0].title, lang: rs[0].lang, repeats: rs.length, gates_passed: rs.filter((r) => r.gates.ok).length };
    for (const m of METRICS) {
      const xs = rs.map((r) => r.metrics[m]);
      row[m] = round(median(xs), m === 'cost_usd' ? 4 : 3);
      if (m === 'quality') row.quality_spread = round(spread(xs), 3);
    }
    briefs[id] = row;
  }
  const list = Object.values(briefs);
  const mean = (m) => {
    const xs = list.map((b) => b[m]).filter((x) => typeof x === 'number');
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const totals = {
    briefs: list.length,
    runs: runs.length,
    quality: round(mean('quality')),
    judge: round(mean('judge')),
    functional: round(mean('functional')),
    runtime: round(mean('runtime')),
    a11y: round(mean('a11y')),
    layout: round(mean('layout')),
    usd_per_brief: round(mean('cost_usd'), 4),
    minutes_per_brief: round(mean('minutes'), 2),
    tokens_per_brief: Math.round(mean('tokens') || 0),
    tool_calls_per_brief: round(mean('tool_calls'), 1),
    http_calls_per_brief: round(mean('http_calls'), 1),
    publishes_per_brief: round(mean('publishes'), 2),
    gate_pass_rate: round(runs.filter((r) => r.gates.ok).length / Math.max(1, runs.length)),
    total_cost_usd: round(runs.reduce((a, r) => a + (r.metrics.cost_usd || 0) + (r.judge?.cost_usd || 0), 0), 4),
  };
  return { briefs, totals };
}

export function latestBaseline(suite, mode) {
  const dir = join(BENCH_DIR, 'baselines');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith(`${suite}-`) && f.endsWith('.json')).sort();
  for (const f of files.reverse()) {
    const b = readJson(join(dir, f));
    if (!mode || b.mode === mode) return { path: join(dir, f), data: b };
  }
  return null;
}

export function compare(current, baseline) {
  if (!baseline) return null;
  const d = (a, b) => (typeof a === 'number' && typeof b === 'number' ? round(a - b, 4) : null);
  const totals = Object.fromEntries(Object.keys(current.totals).map((k) => [k, d(current.totals[k], baseline.totals?.[k])]));
  const briefs = {};
  for (const [id, row] of Object.entries(current.briefs)) {
    const b = baseline.briefs?.[id];
    if (!b) continue;
    briefs[id] = Object.fromEntries(METRICS.map((m) => [m, d(row[m], b[m])]));
  }
  return { totals, briefs };
}

export function toBaseline(summary) {
  return {
    suite: summary.suite,
    mode: summary.mode,
    label: summary.label,
    model: summary.model,
    skill_version: summary.skill_version,
    date: summary.finished_at?.slice(0, 10),
    repeat: summary.repeat,
    weights: WEIGHTS,
    totals: summary.aggregate.totals,
    briefs: summary.aggregate.briefs,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (x) => (typeof x === 'number' ? `${Math.round(x * 100)}` : '—');
const delta = (x, invert = false, scale = 100, unit = '') => {
  if (typeof x !== 'number' || x === 0) return '';
  const good = invert ? x < 0 : x > 0;
  return ` <span class="${good ? 'up' : 'down'}">${x > 0 ? '+' : ''}${round(x * scale, 1)}${unit}</span>`;
};

export function writeReport(runDir, summary) {
  writeJson(join(runDir, 'summary.json'), summary);
  const { totals, briefs } = summary.aggregate;
  const cmp = summary.comparison;
  const rows = Object.entries(briefs)
    .map(([id, b]) => {
      const c = cmp?.briefs?.[id];
      const runs = summary.runs.filter((r) => r.brief === id);
      const shot = runs.find((r) => r.screenshots?.desktop);
      const img = (p) => (p ? `<img loading="lazy" src="${esc(relative(runDir, p))}" alt="">` : '');
      return `<tr>
  <td><b>${esc(b.title)}</b><div class="muted">${esc(id)} · ${esc(b.lang)} · ${b.gates_passed}/${b.repeats} gates</div></td>
  <td class="num big">${pct(b.quality)}${delta(c?.quality)}<div class="muted">±${pct(b.quality_spread)}</div></td>
  <td class="num">${pct(b.judge)}</td><td class="num">${pct(b.functional)}</td><td class="num">${pct(b.runtime)}</td><td class="num">${pct(b.a11y)}</td><td class="num">${pct(b.layout)}</td>
  <td class="num">$${b.cost_usd ?? '—'}${delta(c?.cost_usd, true, 1)}</td><td class="num">${b.minutes ?? '—'}</td>
  <td class="num">${b.tokens ? Math.round(b.tokens / 1000) + 'k' : '—'}</td><td class="num">${b.tool_calls ?? '—'}</td><td class="num">${b.http_calls ?? '—'}</td><td class="num">${b.publishes ?? '—'}</td>
  <td class="shots">${img(shot?.screenshots?.desktop)}${img(shot?.screenshots?.mobile)}</td>
</tr>
<tr class="detail"><td colspan="14">${runs
        .map(
          (r) => `<details><summary>r${r.repeat}: quality ${pct(r.metrics.quality)} · ${esc(r.gates.reasons.join(', ') || 'gates ok')} · <a href="${esc(relative(runDir, r.dir))}">files</a></summary>
<ul>${(r.checks?.steps || []).map((s) => `<li class="${s.ok ? 'ok' : 'bad'}">${s.ok ? '✓' : '✗'} ${esc(s.step)}${s.in && s.in !== 'a' ? ` (viewer ${esc(s.in)})` : ''} <span class="muted">${esc(s.detail)}</span></li>`).join('')}</ul>
${r.judge?.summary ? `<p><b>Judge:</b> ${esc(r.judge.summary)}</p>` : ''}
${r.render_summary ? `<p class="muted">${esc(r.render_summary)}</p>` : ''}
</details>`
        )
        .join('')}</td></tr>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent bench — ${esc(summary.label)}</title>
<style>
:root { --bg:#fafaf9; --fg:#1c1917; --muted:#78716c; --line:#e7e5e4; --up:#15803d; --down:#b91c1c; --card:#fff; }
@media (prefers-color-scheme: dark) { :root { --bg:#1c1917; --fg:#f5f5f4; --muted:#a8a29e; --line:#44403c; --up:#4ade80; --down:#f87171; --card:#292524; } }
body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui, sans-serif; }
main { max-width:1280px; margin:0 auto; }
h1 { font-size:22px; margin:0 0 4px; } .muted { color:var(--muted); font-size:12px; }
.kpis { display:flex; flex-wrap:wrap; gap:12px; margin:20px 0; }
.kpi { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px; min-width:120px; }
.kpi b { display:block; font-size:22px; font-variant-numeric:tabular-nums; }
.wrap { overflow-x:auto; } table { border-collapse:collapse; width:100%; background:var(--card); }
th, td { padding:8px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
th { font-size:12px; color:var(--muted); font-weight:600; } .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.big { font-size:18px; font-weight:600; } .up { color:var(--up); font-size:12px; } .down { color:var(--down); font-size:12px; }
.shots img { height:72px; border:1px solid var(--line); border-radius:4px; margin-right:4px; }
tr.detail td { border-bottom:2px solid var(--line); padding-top:0; } li.bad { color:var(--down); } ul { margin:4px 0; padding-left:18px; }
</style></head><body><main>
<h1>Agent build benchmark — ${esc(summary.label)}</h1>
<div class="muted">suite <b>${esc(summary.suite)}</b> · mode ${esc(summary.mode)} · model ${esc(summary.model || 'default')} · skill ${esc(summary.skill_version)} · repeat ${summary.repeat} · ${esc(summary.started_at)}${cmp ? ` · vs ${esc(summary.baseline_path)}` : ''}</div>
<div class="kpis">
  <div class="kpi"><span class="muted">Quality</span><b>${pct(totals.quality)}${delta(cmp?.totals?.quality)}</b></div>
  <div class="kpi"><span class="muted">Gate pass</span><b>${pct(totals.gate_pass_rate)}%</b></div>
  <div class="kpi"><span class="muted">$ / brief</span><b>${totals.usd_per_brief ?? '—'}${delta(cmp?.totals?.usd_per_brief, true, 1)}</b></div>
  <div class="kpi"><span class="muted">Minutes / brief</span><b>${totals.minutes_per_brief ?? '—'}${delta(cmp?.totals?.minutes_per_brief, true, 1)}</b></div>
  <div class="kpi"><span class="muted">Tokens / brief</span><b>${totals.tokens_per_brief ? Math.round(totals.tokens_per_brief / 1000) + 'k' : '—'}</b></div>
  <div class="kpi"><span class="muted">Tool calls / brief</span><b>${totals.tool_calls_per_brief ?? '—'}</b></div>
  <div class="kpi"><span class="muted">Total spend</span><b>$${totals.total_cost_usd}</b></div>
</div>
<p class="muted">Quality = gates (published · not blank on both viewports · no uncaught errors) × (35% judge + 25% functional + 15% runtime + 15% a11y + 10% layout), median of repeats; ± is the spread.</p>
<div class="wrap"><table>
<thead><tr><th>Brief</th><th class="num">Quality</th><th class="num">Judge</th><th class="num">Func</th><th class="num">Runtime</th><th class="num">A11y</th><th class="num">Layout</th><th class="num">$</th><th class="num">Min</th><th class="num">Tokens</th><th class="num">Tools</th><th class="num">HTTP</th><th class="num">Pub</th><th>Screens</th></tr></thead>
<tbody>${rows}</tbody></table></div>
</main></body></html>`;
  writeFileSync(join(runDir, 'report.html'), html);
}
