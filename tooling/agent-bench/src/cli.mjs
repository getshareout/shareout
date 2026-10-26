#!/usr/bin/env node
/**
 * ShareOut agent build benchmark.
 *
 *   node tooling/agent-bench/src/cli.mjs run --suite smoke [--model <id>] [--repeat N]
 *        [--skill <dir>] [--mode cli|mcp] [--label <name>] [--briefs a,b] [--no-judge]
 *        [--judge-model <id>] [--baseline <file>] [--replay <page.html>]
 *   node tooling/agent-bench/src/cli.mjs judge --pairwise <resultsA> <resultsB> [--judge-model <id>]
 *   node tooling/agent-bench/src/cli.mjs judge --dir <brief result dir> --brief <id>
 *   node tooling/agent-bench/src/cli.mjs report <resultsDir> [--baseline <file>]
 *   node tooling/agent-bench/src/cli.mjs baseline <resultsDir>
 *   node tooling/agent-bench/src/cli.mjs list
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BENCH_DIR, SKILL_DIR, appModule, ensureDir, log, readJson, round, timestamp, writeJson } from './lib.mjs';
import { startInstance } from './instance.mjs';
import { runAgent } from './run-agent.mjs';
import { launchBrowser, renderArtifact } from './render.mjs';
import { runChecks } from './checks.mjs';
import { judgeOne, judgePair } from './judge.mjs';
import { aggregate, compare, latestBaseline, quality, toBaseline, writeReport } from './report.mjs';

const YAML = appModule('yaml');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split('=');
    if (inline !== undefined) out[k] = inline;
    else if (k.startsWith('no-')) out[k.slice(3)] = false;
    else if (k === 'pairwise') { out.pairwise = [argv[++i], argv[++i]]; }
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

export function loadBriefs() {
  const dir = join(BENCH_DIR, 'briefs');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => ({ file: f, ...YAML.parse(readFileSync(join(dir, f), 'utf8')) }));
}

function skillVersion(dir) {
  try {
    return readFileSync(join(dir, 'SKILL.md'), 'utf8').match(/^version:\s*"?([^"\n]+)"?/m)?.[1] || null;
  } catch {
    return null;
  }
}

const STORE_RX = {
  json: /\.json\.(get|set|update|list|delete|subscribe|watch)\b|sdk\.json\b/,
  table: /\.table\(|workspace\.table\(/,
  realtime: /\.realtime\(/,
  dataset: /dataset/i,
  email: /\.email\.\w+\(|notifyOwner|email_send/,
};

async function artifactSource(inst, id) {
  const r = await inst.api(`/v1/artifacts/${id}/files`);
  const j = await r.json().catch(() => null);
  const files = j?.files || j?.data?.files || [];
  const parts = [];
  for (const f of files) {
    const path = f.path || f.name;
    if (!/\.(html?|js|mjs|css|json|md)$/i.test(path || '')) continue;
    if (typeof f.content === 'string') parts.push(f.content);
    else {
      const raw = await fetch(`${inst.origin}/a/${j?.slug || ''}/${path}?_raw`, { headers: { cookie: inst.cookie } }).catch(() => null);
      if (raw?.ok) parts.push(await raw.text());
    }
  }
  return { source: parts.join('\n'), files: files.map((f) => f.path || f.name) };
}

async function resolveArtifact(inst, ref) {
  if (ref?.id) {
    const r = await inst.api(`/v1/artifacts/${ref.id}`);
    if (r.ok) {
      const j = await r.json();
      const a = j.artifact || j;
      return { id: a.id || ref.id, slug: a.slug || ref.slug, name: a.name, visibility: a.visibility };
    }
  }
  if (ref?.slug) {
    const list = await (await inst.api('/v1/artifacts?limit=100')).json().catch(() => ({}));
    const a = (list.artifacts || []).find((x) => x.slug === ref.slug);
    if (a) return { id: a.id, slug: a.slug, name: a.name, visibility: a.visibility };
  }
  return null;
}

async function setupArtifacts(inst, brief) {
  const out = {};
  inst.setPhase('setup');
  for (const s of brief.setup || []) {
    const content = readFileSync(join(BENCH_DIR, 'fixtures', s.file), 'utf8');
    const r = await inst.api('/v1/publish', {
      method: 'POST',
      body: JSON.stringify({ name: s.name, slug: s.slug, visibility: s.visibility || 'private', files: [{ path: 'index.html', content, mime: 'text/html' }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`setup publish ${s.key} failed: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    out[s.key] = { id: j.artifact.id, slug: j.deployment.slug, url: j.deployment.url };
    for (const [table, rows] of Object.entries(s.rows || {})) {
      const t = await inst.api(`/v1/data/${j.artifact.id}/tables/${table}`, { method: 'POST', body: JSON.stringify({ rows }) });
      if (!t.ok) throw new Error(`seed rows ${table} failed: ${t.status} ${(await t.text()).slice(0, 200)}`);
    }
  }
  return out;
}

/** Harness self-test: publish a hand-written page as if an agent had built it (no model calls). */
async function replayAgent(inst, brief, setup, file) {
  const started = Date.now();
  inst.setPhase('agent');
  const t = brief.expect?.target && setup[brief.expect.target];
  await inst.api('/v1/publish', {
    method: 'POST',
    body: JSON.stringify({ name: brief.title, slug: t?.slug || brief.id, visibility: 'private', files: [{ path: 'index.html', content: readFileSync(file, 'utf8'), mime: 'text/html' }] }),
  });
  inst.setPhase('post');
  return { mode: 'replay', model: null, cost_usd: 0, wall_ms: Date.now() - started, tokens: { total: 0, output: 0 }, tool_calls: 0, external_hosts: [] };
}

async function runOne({ brief, rep, opts, runDir, runId }) {
  const dir = ensureDir(join(runDir, 'briefs', brief.id, `r${rep}`));
  const stateDir = join(BENCH_DIR, '.state', `${runId}-${brief.id}-r${rep}`);
  const workDir = join(tmpdir(), 'shareout-agent-bench', runId, `${brief.id}-r${rep}`, 'work');
  const vars = { token: `BX${Math.floor(10000 + Math.random() * 89999)}`, token2: `BY${Math.floor(10000 + Math.random() * 89999)}` };
  const record = { brief: brief.id, title: brief.title, lang: brief.lang, repeat: rep, dir, vars, gates: { ok: false, reasons: [] }, metrics: {} };
  let inst;
  let browser;
  try {
    inst = await startInstance({ stateDir, logDir: dir });
    const setup = await setupArtifacts(inst, brief);
    record.setup = setup;

    const agent = opts.replay
      ? await replayAgent(inst, brief, setup, resolve(opts.replay))
      : await runAgent({ brief, inst, skillDir: opts.mode === 'mcp' ? null : opts.skill, mode: opts.mode, model: opts.model, workDir, outDir: dir, setup });
    record.agent = agent;
    const http = inst.counters('agent');
    const publishes = inst.publishes('agent');
    record.http = http;
    record.publishes = publishes;

    let target = null;
    if (brief.expect?.target) {
      target = setup[brief.expect.target];
    } else {
      const refs = publishes.filter((p) => p.status < 300).flatMap((p) => p.refs);
      for (const ref of refs.reverse()) {
        target = await resolveArtifact(inst, ref);
        if (target) break;
      }
      if (!target) {
        const list = await (await inst.api('/v1/artifacts?limit=50')).json().catch(() => ({}));
        const setupIds = new Set(Object.values(setup).map((s) => s.id));
        const a = (list.artifacts || []).filter((x) => !setupIds.has(x.id)).sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)))[0];
        if (a) target = { id: a.id, slug: a.slug, name: a.name };
      }
    }
    const agentPublished = publishes.some((p) => p.status < 300 && !p.error);
    if (!target || !agentPublished) record.gates.reasons.push(agentPublished ? 'no artifact found' : 'agent never published');
    record.artifact = target;

    if (target) {
      inst.setPhase('render');
      const { source, files } = await artifactSource(inst, target.id);
      record.artifact.files = files;
      browser = await launchBrowser();
      const render = await renderArtifact(browser, inst, target, dir);
      record.render = render;
      record.screenshots = { desktop: render.desktop?.screenshot_full || render.desktop?.screenshot, mobile: render.mobile?.screenshot_full || render.mobile?.screenshot };
      record.render_summary = ['desktop', 'mobile']
        .map((v) => {
          const x = render[v];
          if (!x) return '';
          return `${v}: ${x.page_errors.length} errors, ${x.console_errors.length} console, ${x.failed_requests.length} failed req, ${Array.isArray(x.a11y) ? x.a11y.length : '?'} axe rules, overflow ${x.probe?.overflow_x_px ?? '?'}px, LCP ${Math.round(x.probe?.lcp_ms || 0)}ms`;
        })
        .join(' · ');

      inst.setPhase('checks');
      const checks = await runChecks(browser, inst, { ...target, source }, brief, vars, dir);
      const storeSteps = [];
      for (const want of brief.expect?.stores || []) {
        const alts = want.split('|');
        const ok = alts.some((s) => STORE_RX[s]?.test(source));
        storeSteps.push({ step: `uses ${want}`, do: 'store', in: 'a', ok, optional: false, detail: ok ? '' : `source lacks ${want}` });
      }
      if (brief.expect?.target && !publishes.some((p) => p.status < 300 && p.refs.some((r) => r.id === target.id || r.slug === target.slug))) {
        storeSteps.push({ step: 'updated the existing page', do: 'target', in: 'a', ok: false, optional: false, detail: 'no publish to the target artifact' });
      }
      checks.steps.push(...storeSteps);
      const scored = checks.steps.filter((s) => !s.optional || s.ok);
      checks.passed = scored.filter((s) => s.ok).length;
      checks.total = scored.length;
      checks.score = checks.total ? checks.passed / checks.total : 1;
      record.checks = checks;

      if (!render.scores.gates.not_blank) record.gates.reasons.push('blank page');
      if (!render.scores.gates.no_uncaught_errors) record.gates.reasons.push('uncaught errors');
      await browser.close();
      browser = null;

      if (opts.judge !== false) {
        record.judge = await judgeOne({ dir, brief, model: opts['judge-model'] });
        writeJson(join(dir, 'judge.json'), record.judge);
      }
    }
    record.failed_requests = inst.state.requests.filter((r) => r.status >= 400 && r.phase !== 'setup').slice(0, 60);
    record.gates.ok = record.gates.reasons.length === 0;
    const parts = {
      judge: record.judge?.score ?? undefined,
      functional: record.checks?.score ?? 0,
      runtime: record.render?.scores.runtime ?? 0,
      a11y: record.render?.scores.a11y ?? 0,
      layout: record.render?.scores.layout ?? 0,
    };
    record.metrics = {
      quality: round(quality(parts, record.gates.ok), 4),
      judge: parts.judge ?? null,
      functional: parts.functional,
      runtime: parts.runtime,
      a11y: parts.a11y,
      layout: parts.layout,
      cost_usd: agent.cost_usd,
      minutes: round(agent.wall_ms / 60000, 2),
      tokens: agent.tokens.total,
      output_tokens: agent.tokens.output,
      tool_calls: agent.tool_calls,
      http_calls: http.http,
      publishes: http.publishes,
    };
    if (agent.external_hosts.length) record.warnings = [`agent commands referenced non-local hosts: ${agent.external_hosts.join(', ')}`];
  } catch (e) {
    record.error = String(e.stack || e).slice(0, 2000);
    record.gates.reasons.push('bench error');
    log(`ERROR ${brief.id} r${rep}: ${e.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (inst) await inst.stop();
  }
  writeJson(join(dir, 'result.json'), record);
  log(`${brief.id} r${rep}: quality ${record.metrics.quality ?? 0} ${record.gates.ok ? '' : `(gates: ${record.gates.reasons.join(', ')})`}`);
  return record;
}

async function cmdRun(opts) {
  const suite = opts.suite || 'smoke';
  const repeat = Number(opts.repeat || 1);
  opts.mode = opts.mode || 'cli';
  opts.skill = resolve(opts.skill || SKILL_DIR);
  if (!['cli', 'mcp'].includes(opts.mode)) throw new Error('--mode must be cli or mcp');
  if (opts.mode === 'cli' && !existsSync(join(opts.skill, 'SKILL.md'))) throw new Error(`no SKILL.md in ${opts.skill}`);
  let briefs = loadBriefs().filter((b) => (b.suites || []).includes(suite));
  if (opts.briefs) {
    const want = new Set(String(opts.briefs).split(','));
    briefs = loadBriefs().filter((b) => want.has(b.id));
  }
  if (!briefs.length) throw new Error(`no briefs for suite ${suite}`);
  const label = opts.label || `${suite}-${opts.mode}${opts.model ? `-${opts.model}` : ''}`;
  const runId = `${timestamp()}-${label}`.replace(/[^\w.-]+/g, '-');
  const runDir = ensureDir(join(BENCH_DIR, 'results', runId));
  const startedAt = new Date().toISOString();
  log(`run ${runId}: ${briefs.length} briefs × ${repeat}, mode ${opts.mode}, model ${opts.model || 'default'}, skill ${opts.skill}`);

  const runs = [];
  for (let rep = 1; rep <= repeat; rep++) {
    for (const brief of briefs) runs.push(await runOne({ brief, rep, opts, runDir, runId }));
  }
  const agg = aggregate(runs);
  const base = opts.baseline ? { path: resolve(opts.baseline), data: readJson(resolve(opts.baseline)) } : latestBaseline(suite, opts.mode);
  const summary = {
    suite,
    label,
    mode: opts.mode,
    model: opts.model || runs.find((r) => r.agent?.model)?.agent.model || null,
    judge_model: opts['judge-model'] || runs.find((r) => r.judge?.model)?.judge.model || null,
    skill: opts.skill,
    skill_version: opts.mode === 'mcp' ? null : skillVersion(opts.skill),
    repeat,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    aggregate: agg,
    baseline_path: base?.path || null,
    comparison: compare(agg, base?.data),
    runs: runs.map((r) => ({ ...r, render: r.render ? { scores: r.render.scores } : undefined })),
  };
  writeReport(runDir, summary);
  log(`done: quality ${agg.totals.quality} · $${agg.totals.usd_per_brief}/brief · ${agg.totals.minutes_per_brief} min/brief · total $${agg.totals.total_cost_usd}`);
  console.log(join(runDir, 'report.html'));
}

async function cmdJudge(opts) {
  const briefs = Object.fromEntries(loadBriefs().map((b) => [b.id, b]));
  if (opts.pairwise) {
    const [a, b] = opts.pairwise.map((p) => resolve(p));
    const sa = readJson(join(a, 'summary.json'));
    const sb = readJson(join(b, 'summary.json'));
    const out = { a: a, b: b, label_a: sa.label, label_b: sb.label, briefs: {}, wins: { A: 0, B: 0, tie: 0 }, cost_usd: 0 };
    for (const id of Object.keys(sa.aggregate.briefs)) {
      if (!sb.aggregate.briefs[id]) continue;
      const ra = sa.runs.find((r) => r.brief === id && r.screenshots);
      const rb = sb.runs.find((r) => r.brief === id && r.screenshots);
      if (!ra || !rb) continue;
      const res = await judgePair({ dirA: ra.dir, dirB: rb.dir, brief: briefs[id], model: opts['judge-model'], workDir: join(b, 'pairwise', id) });
      out.briefs[id] = res;
      if (res.winner) out.wins[res.winner]++;
      out.cost_usd += res.cost_usd || 0;
      log(`pairwise ${id}: ${res.winner} — ${res.reason?.slice(0, 120)}`);
    }
    writeJson(join(b, `pairwise-vs-${sa.label}.json`), out);
    console.log(JSON.stringify(out.wins));
    return;
  }
  if (opts.dir) {
    const brief = briefs[opts.brief];
    if (!brief) throw new Error('--brief <id> required with --dir');
    const r = await judgeOne({ dir: resolve(opts.dir), brief, model: opts['judge-model'] });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  throw new Error('judge needs --pairwise <a> <b> or --dir <dir> --brief <id>');
}

function cmdReport(opts) {
  const dir = resolve(opts._[1]);
  const summary = readJson(join(dir, 'summary.json'));
  const base = opts.baseline ? { path: resolve(opts.baseline), data: readJson(resolve(opts.baseline)) } : latestBaseline(summary.suite, summary.mode);
  summary.baseline_path = base?.path || null;
  summary.comparison = compare(summary.aggregate, base?.data);
  writeReport(dir, summary);
  console.log(join(dir, 'report.html'));
}

function cmdBaseline(opts) {
  const dir = resolve(opts._[1]);
  const summary = readJson(join(dir, 'summary.json'));
  const b = toBaseline(summary);
  const path = join(BENCH_DIR, 'baselines', `${summary.suite}-${b.date}${summary.mode === 'mcp' ? '-mcp' : ''}.json`);
  writeJson(path, b);
  console.log(path);
}

function cmdList() {
  for (const b of loadBriefs()) console.log(`${b.id.padEnd(22)} ${b.lang}  ${(b.suites || []).join(',').padEnd(11)} ${b.title}`);
}

const opts = parseArgs(process.argv.slice(2));
const cmd = opts._[0] || 'help';
const commands = { run: cmdRun, judge: cmdJudge, report: cmdReport, baseline: cmdBaseline, list: cmdList };
if (!commands[cmd]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ''));
  process.exit(cmd === 'help' ? 0 : 2);
}
Promise.resolve(commands[cmd](opts)).catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});
