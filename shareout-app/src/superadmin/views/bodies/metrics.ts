/**
 * Platform metrics views: artifacts, traffic, funnel, and LLM token usage.
 */

import { escapeHtml } from '../../../html/utils';
import type { PlatformMetrics, AiUsageMetrics } from '../../metrics';
import type { FunnelMetrics, StorageMetrics } from '../../insights';
import { barChart, bytes, bytesDistribution, card, distribution, fmt, stat, stat2 } from '../components';
import { largestArtifactsTable, modelTable, recentTable, tokenWorkspacesTable, topArtifactsTable } from '../tables';

export function artifactsBody(m: PlatformMetrics, s: StorageMetrics): string {
  return `
    <div class="sa-grid-3">
      ${card('By type', distribution(m.artifacts.byType))}
      ${card('By visibility', distribution(m.artifacts.byVisibility))}
      ${card('Created', barChart(m.artifacts.createdDaily))}
    </div>
    <div class="sa-grid" style="margin-top:var(--space-4)">
      ${card('Top by views', topArtifactsTable(m.artifacts.topByViews))}
      ${card('Recently created', recentTable(m.artifacts.recent))}
    </div>
    <h2 class="sa-subhead">Storage — ${bytes(s.totalBytes)} total</h2>
    <div class="sa-grid">
      ${card('By type', bytesDistribution(s.byType))}
      ${card('Largest artifacts', largestArtifactsTable(s.topArtifacts))}
    </div>`;
}

export function trafficBody(m: PlatformMetrics): string {
  return `
    <div class="sa-grid">
      ${card('Views', barChart(m.traffic.viewsDaily))}
      ${card('New users', barChart(m.usersGrowthDaily))}
    </div>
    <div class="sa-grid" style="margin-top:var(--space-4)">
      ${card('Top countries', distribution(m.traffic.topCountries))}
      ${card('Top referrers', distribution(m.traffic.topReferrers))}
    </div>`;
}

export function funnelBody(f: FunnelMetrics): string {
  const steps = f.steps
    .map(
      (s) => `<li>
        <span class="sa-bar-label">${escapeHtml(s.label)}</span>
        <span class="sa-bar-track"><span class="sa-bar-fill" style="width:${s.pct.toFixed(1)}%"></span></span>
        <span class="sa-bar-count">${fmt(s.count)} · ${s.pct.toFixed(0)}%</span>
      </li>`
    )
    .join('');
  return `
    <div class="sa-grid">
      ${card(`Funnel — ${f.conversionPct.toFixed(1)}% convert to submit`, `<ul class="sa-bars">${steps || '<div class="sa-empty">No funnel data yet.</div>'}</ul>`)}
      ${card('Submits', barChart(f.submitDaily))}
    </div>`;
}

export function tokensBody(m: PlatformMetrics, ai?: AiUsageMetrics): string {
  return `
    <div class="sa-grid">
      ${card('Tokens', barChart(m.tokens.daily))}
      ${card('Top workspaces by cost', tokenWorkspacesTable(m.tokens.topWorkspaces))}
    </div>
    <div style="margin-top:var(--space-4)">
      ${card('By model', modelTable(m.tokens.byModel))}
    </div>
    ${ai ? aiUsageSection(ai) : ''}`;
}

// Non-LLM Workers AI usage (Whisper voice transcription today). Cost is tracked
// for visibility only — it is NOT debited from any workspace balance.
function aiUsageSection(ai: AiUsageMetrics): string {
  const body = ai.calls
    ? `<div class="sa-stats">
         ${stat(ai.calls, 'AI calls', 'voice transcriptions etc.')}
         ${stat2(`${ai.audioMinutes}<span class="sa-muted" style="font-size:14px">min</span>`, 'Audio transcribed', 'Whisper')}
         ${stat2(`$${ai.costUsd.toFixed(4)}`, 'Tracked cost', 'not billed to balances')}
       </div>
       <div style="margin-top:var(--space-4)">${card('By kind', distribution(ai.byKind))}</div>`
    : `<div class="sa-empty">No non-LLM AI usage in this window.</div>`;
  return `<div style="margin-top:var(--space-4)">${card('AI usage (non-LLM, tracking-only)', body)}</div>`;
}
