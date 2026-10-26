// Scoring for the knowledge retrieval eval. Plain JS: the eval (workerd) judges each
// question's hits with judge(); the Node host aggregates, renders and compares with the
// committed baseline. Metric definitions: README.md.
import { LANGS, TYPES, GENRES, inSection } from './golden.mjs';

/** Results asked for per question (searchCorpus caps at 30). */
export const LIMIT = 20;

const SOURCES = ['page', 'site', 'md', 'txt', 'json'];

/**
 * For each gold passage, the 1-based rank of the first hit that carries it (its doc — or an
 * alt's — and its evidence in the passage text; for a `scope: "section"` option, also located
 * in that section), else null. `docFound`: first hit from a gold doc at all, evidence or not.
 */
export function judge(question, hits, norm) {
  const options = question.gold.map((g) => [g, ...(g.alt || [])].map((o) => ({ doc: o.doc, ev: norm(o.evidence), section: o.scope === 'section' ? o.section : null })));
  const found = options.map(() => null);
  const docFound = options.map(() => null);
  hits.forEach((h, i) => {
    const text = norm(h.text);
    options.forEach((opts, g) => {
      if (docFound[g] === null && opts.some((o) => o.doc === h.doc)) docFound[g] = i + 1;
      if (found[g] === null && opts.some((o) => o.doc === h.doc && text.includes(o.ev) && (o.section === null || inSection(h.locator, o.section)))) found[g] = i + 1;
    });
  });
  return { found, docFound };
}

const log2 = Math.log2;
const firstOf = (ranks) => {
  const hit = ranks.filter((x) => x !== null);
  return hit.length ? Math.min(...hit) : null;
};
const top10 = (rank) => rank !== null && rank !== undefined && rank <= 10;

/** Per-question metrics from one judged record. */
export function scoreRecord(r) {
  const n = r.found.length;
  const within = (ranks, k) => ranks.filter((x) => x !== null && x <= k).length / n;
  const ranks = [...new Set(r.found.filter((x) => x !== null && x <= 10))];
  const dcg = ranks.reduce((s, rank) => s + 1 / log2(rank + 1), 0);
  let idcg = 0;
  for (let i = 1; i <= Math.min(n, 10); i++) idcg += 1 / log2(i + 1);
  const hit = r.found.filter((x) => x !== null);
  return {
    r5: within(r.found, 5),
    r10: within(r.found, 10),
    r20: within(r.found, 20),
    ndcg10: dcg / idcg,
    rr: hit.length ? 1 / Math.min(...hit) : 0,
    doc10: within(r.docFound, 10),
    zero: r.hits === 0 ? 1 : 0,
    starved: r.hits < Math.min(LIMIT, r.controlHits) ? 1 : 0,
    // Found in the member's top 10 when nobody else's private docs exist, but not with them.
    permLoss: top10(firstOf(r.ctlFound)) && !top10(firstOf(r.found)) ? 1 : 0,
  };
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : 0);

export function aggregate(records) {
  const scores = records.map(scoreRecord);
  const mean = (k) => (scores.length ? scores.reduce((s, x) => s + x[k], 0) / scores.length : 0);
  const ms = records.map((r) => r.ms).sort((a, b) => a - b);
  return {
    n: records.length,
    r5: mean('r5'), r10: mean('r10'), r20: mean('r20'), ndcg10: mean('ndcg10'), mrr: mean('rr'), doc10: mean('doc10'),
    zero: mean('zero'), starved: mean('starved'), permLoss: mean('permLoss'),
    p50: percentile(ms, 50), p95: percentile(ms, 95),
  };
}

/** Overall plus one row per language, question type, gold source format, gold genre and tag. */
export function slices(records) {
  const order = { lang: LANGS, type: TYPES, source: SOURCES, genre: GENRES, tag: ['perm'] };
  const keyOf = { lang: (r) => [r.lang], type: (r) => [r.type], source: (r) => r.sources, genre: (r) => r.genres, tag: (r) => r.tags };
  const rows = [{ group: 'all', value: 'all', ...aggregate(records) }];
  for (const [group, values] of Object.entries(order)) {
    for (const value of values) {
      const subset = records.filter((r) => keyOf[group](r).includes(value));
      if (subset.length) rows.push({ group, value, ...aggregate(subset) });
    }
  }
  return rows;
}

const label = (row) => (row.group === 'all' ? '**all**' : `${row.group}: ${row.group === 'lang' ? row.value.replace('-', '→') : row.value}`);
const f3 = (x) => x.toFixed(3);
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const ms = (x) => (x < 10 ? x.toFixed(1) : Math.round(x).toString());

export function renderTable(rows) {
  const out = [
    '| Slice | n | R@5 | R@10 | R@20 | nDCG@10 | MRR | doc R@10 | zero | starved | perm loss | p50 ms | p95 ms |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
  ];
  for (const r of rows) {
    out.push(`| ${label(r)} | ${r.n} | ${f3(r.r5)} | ${f3(r.r10)} | ${f3(r.r20)} | ${f3(r.ndcg10)} | ${f3(r.mrr)} | ${f3(r.doc10)} | ${pct(r.zero)} | ${pct(r.starved)} | ${pct(r.permLoss)} | ${ms(r.p50)} | ${ms(r.p95)} |`);
  }
  return out.join('\n');
}

const firstRank = (r) => firstOf(r.found);

/** What a baseline keeps: the slice table and each question's first-hit rank. */
export function baselineOf(result) {
  return {
    meta: result.meta,
    slices: result.slices,
    firstRank: Object.fromEntries(result.records.map((r) => [r.id, firstRank(r)])),
  };
}

const signed = (x, digits = 3) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(digits)}`;

/** Deltas against a committed baseline: per slice, plus questions that entered / left the top 10. */
export function renderDelta(result, base) {
  const key = (r) => `${r.group}\u0000${r.value}`;
  const before = new Map(base.slices.map((r) => [key(r), r]));
  const out = [
    `Δ vs baseline (${base.meta.mode}${base.meta.model ? ` · ${base.meta.model}` : ''} · ${base.meta.commit} · ${base.meta.date.slice(0, 10)})`,
    '',
    '| Slice | n | ΔR@5 | ΔR@10 | ΔR@20 | ΔnDCG@10 | ΔMRR | Δstarved | Δperm loss | Δp50 ms |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
  ];
  for (const r of result.slices) {
    const b = before.get(key(r));
    if (!b || r.group === 'genre') continue; // genre deltas stay in the JSON; the table is for the PR description
    out.push(`| ${label(r)} | ${r.n}${r.n === b.n ? '' : ` (was ${b.n})`} | ${signed(r.r5 - b.r5)} | ${signed(r.r10 - b.r10)} | ${signed(r.r20 - b.r20)} | ${signed(r.ndcg10 - b.ndcg10)} | ${signed(r.mrr - b.mrr)} | ${signed(100 * (r.starved - b.starved), 1)} pt | ${signed(100 * (r.permLoss - b.permLoss), 1)} pt | ${signed(r.p50 - b.p50, 1)} |`);
  }
  const entered = [];
  const left = [];
  for (const r of result.records) {
    if (!(r.id in base.firstRank)) continue;
    const now = top10(firstRank(r));
    const was = top10(base.firstRank[r.id]);
    if (now && !was) entered.push(r.id);
    if (was && !now) left.push(r.id);
  }
  const list = (ids) => (ids.length ? ` — ${ids.slice(0, 40).join(', ')}${ids.length > 40 ? ', …' : ''}` : '');
  out.push('', `First gold passage entered the top 10: **${entered.length}**${list(entered)}`, `Left the top 10: **${left.length}**${list(left)}`);
  return out.join('\n');
}

export function renderReport(result, base) {
  const m = result.meta;
  const lines = [
    `## Knowledge retrieval eval — ${m.mode}${m.model ? ` · ${m.model}` : ''}`,
    '',
    `${m.date.slice(0, 16).replace('T', ' ')} UTC · commit ${m.commit} · ${m.docs} docs (${m.privateDocs} private to another member) · ${m.chunks} chunks · ${m.questions} questions · top ${LIMIT} · ingest ${(m.ingestMs / 1000).toFixed(1)} s`,
    '',
    renderTable(result.slices),
  ];
  if (base) lines.push('', renderDelta(result, base));
  return `${lines.join('\n')}\n`;
}
