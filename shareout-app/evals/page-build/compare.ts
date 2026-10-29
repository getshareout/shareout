/** Diff of two results files: pass rate, the aggregates, and per-item regressions. */
import { failureReason, pct } from './report';
import type { EvalResults, RunRecord } from './types';

export interface ItemDelta {
  itemId: string;
  /** Share of this item's runs that passed, 0..1. */
  before: number;
  after: number;
  reason?: string;
}

export interface Comparison {
  setVersionMismatch: boolean;
  passRate: { before: number; after: number; delta: number };
  meanCheckRate: { before: number; after: number; delta: number };
  meanStaticIssues: { before: number; after: number; delta: number };
  meanVerifyIssues: { before: number | null; after: number | null; delta: number | null };
  wallMeanMs: { before: number; after: number; delta: number };
  regressions: ItemDelta[];
  improvements: ItemDelta[];
  onlyBefore: string[];
  onlyAfter: string[];
}

function rates(runs: RunRecord[]): Map<string, { rate: number; lastFailure?: RunRecord }> {
  const by = new Map<string, RunRecord[]>();
  for (const r of runs) by.set(r.itemId, [...(by.get(r.itemId) ?? []), r]);
  return new Map([...by].map(([id, rs]) => [id, { rate: rs.filter((r) => r.passed).length / rs.length, lastFailure: [...rs].reverse().find((r) => !r.passed) }]));
}

const diff = (before: number, after: number) => ({ before, after, delta: +(after - before).toFixed(4) });

export function compareResults(before: EvalResults, after: EvalResults): Comparison {
  const a = rates(before.runs);
  const b = rates(after.runs);
  const regressions: ItemDelta[] = [];
  const improvements: ItemDelta[] = [];
  for (const [itemId, now] of b) {
    const was = a.get(itemId);
    if (!was) continue;
    if (now.rate < was.rate) regressions.push({ itemId, before: was.rate, after: now.rate, reason: now.lastFailure ? failureReason(now.lastFailure) : undefined });
    else if (now.rate > was.rate) improvements.push({ itemId, before: was.rate, after: now.rate });
  }
  const bv = before.aggregate.meanVerifyIssues;
  const av = after.aggregate.meanVerifyIssues;
  return {
    setVersionMismatch: before.setVersion !== after.setVersion,
    passRate: diff(before.aggregate.passRate, after.aggregate.passRate),
    meanCheckRate: diff(before.aggregate.meanCheckRate, after.aggregate.meanCheckRate),
    meanStaticIssues: diff(before.aggregate.meanStaticIssues, after.aggregate.meanStaticIssues),
    meanVerifyIssues: { before: bv, after: av, delta: bv !== null && av !== null ? +(av - bv).toFixed(2) : null },
    wallMeanMs: diff(before.aggregate.wallMs.mean, after.aggregate.wallMs.mean),
    regressions,
    improvements,
    onlyBefore: [...a.keys()].filter((id) => !b.has(id)),
    onlyAfter: [...b.keys()].filter((id) => !a.has(id)),
  };
}

const signed = (n: number | null, unit = '') => (n === null ? 'n/a' : `${n > 0 ? '+' : ''}${n}${unit}`);

export function renderComparison(c: Comparison, labels: { before: string; after: string }): string {
  const lines = [
    `# Page-build eval — ${labels.before} → ${labels.after}`,
    '',
    ...(c.setVersionMismatch ? ['**The two files use different set versions: items may not mean the same thing.**', ''] : []),
    '| metric | before | after | change |',
    '|---|---|---|---|',
    `| pass rate | ${pct(c.passRate.before)} | ${pct(c.passRate.after)} | ${signed(+(c.passRate.delta * 100).toFixed(1), ' pts')} |`,
    `| expectation checks held | ${pct(c.meanCheckRate.before)} | ${pct(c.meanCheckRate.after)} | ${signed(+(c.meanCheckRate.delta * 100).toFixed(1), ' pts')} |`,
    `| mean static issues | ${c.meanStaticIssues.before} | ${c.meanStaticIssues.after} | ${signed(c.meanStaticIssues.delta)} |`,
    `| mean verify issues | ${c.meanVerifyIssues.before ?? 'n/a'} | ${c.meanVerifyIssues.after ?? 'n/a'} | ${signed(c.meanVerifyIssues.delta)} |`,
    `| mean wall time (ms) | ${c.wallMeanMs.before} | ${c.wallMeanMs.after} | ${signed(c.wallMeanMs.delta)} |`,
  ];
  lines.push('', `## Regressions (${c.regressions.length})`);
  if (c.regressions.length) for (const r of c.regressions) lines.push(`- ${r.itemId}: ${pct(r.before)} → ${pct(r.after)}${r.reason ? ` — ${r.reason}` : ''}`);
  else lines.push('none');
  lines.push('', `## Improvements (${c.improvements.length})`);
  if (c.improvements.length) for (const r of c.improvements) lines.push(`- ${r.itemId}: ${pct(r.before)} → ${pct(r.after)}`);
  else lines.push('none');
  if (c.onlyBefore.length) lines.push('', `Only in ${labels.before}: ${c.onlyBefore.join(', ')}`);
  if (c.onlyAfter.length) lines.push('', `Only in ${labels.after}: ${c.onlyAfter.join(', ')}`);
  return `${lines.join('\n')}\n`;
}
