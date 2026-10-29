/** Aggregates over a results file, and the short markdown summary written next to it. */
import type { Aggregate, EvalResults, RunRecord, Usage } from './types';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number, d = 2) => +n.toFixed(d);

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

export function aggregate(runs: RunRecord[]): Aggregate {
  const built = runs.filter((r) => r.built);
  const verified = runs.filter((r) => r.verify && r.verify.status !== 'partial');
  const walls = runs.map((r) => r.wallMs);
  const usages = runs.map((r) => r.usage).filter((u): u is Usage => !!u);
  return {
    runs: runs.length,
    built: built.length,
    passed: runs.filter((r) => r.passed).length,
    passRate: runs.length ? round(runs.filter((r) => r.passed).length / runs.length, 4) : 0,
    meanCheckRate: round(mean(built.map((r) => (r.checks.length ? r.checks.filter((c) => c.pass).length / r.checks.length : 1))), 4),
    meanStaticIssues: round(mean(built.map((r) => (r.static?.errors ?? 0) + (r.static?.warnings ?? 0)))),
    meanVerifyIssues: verified.length ? round(mean(verified.map((r) => (r.verify!.errors + r.verify!.warnings)))) : null,
    verified: verified.length,
    wallMs: { mean: Math.round(mean(walls)), p50: percentile(walls, 50), max: Math.max(0, ...walls), total: walls.reduce((a, b) => a + b, 0) },
    usage: usages.length ? { tokens: usages.reduce((a, u) => a + u.tokens, 0), costUsd: round(usages.reduce((a, u) => a + u.costUsd, 0), 4) } : null,
  };
}

export const pct = (n: number) => `${round(n * 100, 1)}%`;
const secs = (ms: number) => `${round(ms / 1000, 1)}s`;

/** Why a run failed, in one short phrase. */
export function failureReason(r: RunRecord): string {
  if (r.error) return r.error;
  const parts: string[] = [];
  if (r.static?.errors) parts.push(`${r.static.errors} static error(s): ${r.static.issues.filter((i) => i.severity === 'error').slice(0, 2).map((i) => i.rule).join(', ')}`);
  if (r.verify?.status === 'fail') parts.push(`verify failed (${r.verify.errors} error(s))`);
  const missed = r.checks.filter((c) => !c.pass).map((c) => c.name);
  if (missed.length) parts.push(`missed: ${missed.slice(0, 4).join(', ')}${missed.length > 4 ? ` +${missed.length - 4}` : ''}`);
  return parts.join('; ') || 'unknown';
}

export function renderSummary(res: EvalResults): string {
  const a = res.aggregate;
  const lines = [
    `# Page-build eval — ${res.startedAt}`,
    '',
    `Instance ${res.origin}, workspace ${res.workspace}. Set v${res.setVersion}, ${res.repeat} run(s) per item${res.verify ? '' : ', browser verify off'}.`,
    '',
    '| metric | value |',
    '|---|---|',
    `| pass rate | ${pct(a.passRate)} (${a.passed}/${a.runs}) |`,
    `| built | ${a.built}/${a.runs} |`,
    `| expectation checks held (built runs) | ${pct(a.meanCheckRate)} |`,
    `| mean static issues per page | ${a.meanStaticIssues} |`,
    `| mean verify issues per page | ${a.meanVerifyIssues === null ? 'n/a (no browser verify)' : `${a.meanVerifyIssues} (${a.verified} verified)`} |`,
    `| wall time per page | mean ${secs(a.wallMs.mean)}, p50 ${secs(a.wallMs.p50)}, max ${secs(a.wallMs.max)} |`,
    `| tokens / cost the usage ledger exposes | ${a.usage ? `${a.usage.tokens} tokens, $${a.usage.costUsd}` : 'n/a'} |`,
  ];
  const failed = res.runs.filter((r) => !r.passed);
  if (failed.length) {
    lines.push('', '## Failures', '', '| item | run | why |', '|---|---|---|');
    for (const r of failed) lines.push(`| ${r.itemId} | ${r.run} | ${failureReason(r).replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
  }
  if (res.created.length) lines.push('', `Pages created (tag \`eval-page-build\`): ${res.created.length}.`);
  return `${lines.join('\n')}\n`;
}
