/**
 * Model judge: `claude -p` reads the screenshots + brief + rubric and returns scores.
 * Read is the only tool; it runs in the result dir, isolated like the agent runs.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BENCH_DIR, childClaudeEnv, ensureDir, log, run } from './lib.mjs';

export const DIMENSIONS = ['hierarchy', 'typography', 'color_restraint', 'spacing', 'craft_states', 'fidelity'];

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: Object.fromEntries(DIMENSIONS.map((d) => [d, { type: 'integer', minimum: 1, maximum: 5 }])),
      required: DIMENSIONS,
    },
    notes: { type: 'object', properties: Object.fromEntries(DIMENSIONS.map((d) => [d, { type: 'string' }])) },
    summary: { type: 'string' },
  },
  required: ['scores', 'summary'],
};

const PAIR_SCHEMA = {
  type: 'object',
  properties: {
    winner: { type: 'string', enum: ['A', 'B', 'tie'] },
    by_dimension: { type: 'object', properties: Object.fromEntries(DIMENSIONS.map((d) => [d, { type: 'string', enum: ['A', 'B', 'tie'] }])) },
    reason: { type: 'string' },
  },
  required: ['winner', 'reason'],
};

const SHOTS = ['desktop.png', 'desktop-full.png', 'mobile.png', 'mobile-full.png', 'after-checks.png'];

function rubric() {
  return readFileSync(join(BENCH_DIR, 'rubric', 'judge.md'), 'utf8');
}

async function askJudge({ cwd, prompt, schema, model, budgetUsd = 2 }) {
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--setting-sources', 'project',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', 'Read', '--allowedTools', 'Read',
    '--permission-prompts', 'none', '--json-schema', JSON.stringify(schema), '--max-budget-usd', String(budgetUsd)];
  if (model) args.push('--model', model);
  const res = await run('claude', args, { cwd, env: childClaudeEnv(), input: prompt, timeoutMs: 8 * 60_000 });
  let out;
  try { out = JSON.parse(res.stdout); } catch { return { error: `judge output not JSON: ${res.stdout.slice(0, 300)} ${res.stderr.slice(0, 300)}` }; }
  let data = out.structured_output;
  if (!data && typeof out.result === 'string') {
    const m = out.result.match(/\{[\s\S]*\}/);
    try { data = m && JSON.parse(m[0]); } catch {}
  }
  return { data, cost_usd: out.total_cost_usd ?? null, model: Object.keys(out.modelUsage || {})[0] || model || null, ms: res.ms, error: data ? null : `no structured output: ${String(out.result).slice(0, 300)}` };
}

export function judgeScore(scores) {
  if (!scores) return null;
  const vals = DIMENSIONS.map((d) => scores[d]).filter((x) => typeof x === 'number');
  if (!vals.length) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length - 1) / 4;
}

/** Score one result dir (it must hold the screenshots); `brief` is the brief object. */
export async function judgeOne({ dir, brief, model }) {
  const shots = SHOTS.filter((s) => existsSync(join(dir, s)));
  if (!shots.length) return { error: 'no screenshots', score: 0 };
  const prompt = `${rubric()}

---

## The brief (what the person asked for, verbatim)

${brief.prompt.trim()}

Brief language: ${brief.lang}.

## Screenshots

Read each of these image files in the current directory before scoring: ${shots.join(', ')}.
(desktop = 1280×800, mobile = 390×844; "-full" = the whole page height; after-checks = desktop
after a scripted test user tried the main actions with placeholder values like "BX12345".)

Return the six scores (1–5), a one-sentence note per dimension, and a two-sentence summary.`;
  log(`judge ${brief.id}: ${shots.length} screenshots`);
  const r = await askJudge({ cwd: dir, prompt, schema: SCORE_SCHEMA, model });
  return { ...r, scores: r.data?.scores || null, notes: r.data?.notes || null, summary: r.data?.summary || null, score: judgeScore(r.data?.scores), data: undefined };
}

/** Blind A/B: copy both sets of screenshots under neutral names, randomise order. */
export async function judgePair({ dirA, dirB, brief, model, workDir }) {
  ensureDir(workDir);
  const flip = Math.random() < 0.5;
  const [first, second] = flip ? [dirB, dirA] : [dirA, dirB];
  const listed = [];
  for (const [label, d] of [['A', first], ['B', second]]) {
    for (const s of SHOTS) {
      if (!existsSync(join(d, s))) continue;
      const name = `${label}-${basename(s)}`;
      copyFileSync(join(d, s), join(workDir, name));
      listed.push(name);
    }
  }
  const prompt = `${rubric()}

---

Two different pages were built for the same request. Compare them on the rubric dimensions
and pick the better page overall. They are labelled A and B in random order; ignore the labels.

## The brief

${brief.prompt.trim()}

## Screenshots (read them all)

${listed.join(', ')}`;
  const r = await askJudge({ cwd: workDir, prompt, schema: PAIR_SCHEMA, model });
  const unflip = (w) => (w === 'tie' || !w ? w : flip ? (w === 'A' ? 'B' : 'A') : w);
  const data = r.data || {};
  return {
    winner: unflip(data.winner),
    by_dimension: data.by_dimension ? Object.fromEntries(Object.entries(data.by_dimension).map(([k, v]) => [k, unflip(v)])) : null,
    reason: data.reason || null,
    presented_b_first: flip,
    cost_usd: r.cost_usd,
    error: r.error,
  };
}
