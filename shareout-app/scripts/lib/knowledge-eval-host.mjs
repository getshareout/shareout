// Node side of the knowledge retrieval eval, reached from workerd through a Miniflare
// service binding (vitest.eval.config.ts):
//   POST /embed   embeddings for dense mode — Workers AI REST API, cached on disk per model
//   POST /report  metrics, the markdown report, results files, the baseline (--baseline)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Response } from 'miniflare';
import { baselineOf, renderReport, renderTable, slices } from '../../tests/eval/knowledge/metrics.mjs';

const TEXT_FIELDS = ['text', 'documents', 'queries'];
const BATCH = 32; // qwen3-embedding takes at most 32 texts per call; bge-base 100
const BASELINE_DIR = 'tests/eval/knowledge';
const MARK_START = '<!-- eval:table -->';
const MARK_END = '<!-- /eval:table -->';

/**
 * The service binding handler. `model` overrides the embedding model the code asks for
 * (default: none — the branch's own model). Credentials come from the environment.
 */
export function evalHost({ appDir, out, model, baseline }) {
  const cacheDir = path.join(out, 'cache');
  const caches = new Map();

  async function embed({ model: asked, input, phase }) {
    const req = embeddingRequest(asked, input, phase, model);
    if (req.model === 'local-hash') return { shape: [req.texts.length, 256], data: req.texts.map(hashVector) };
    const cache = loadCache(req.model);
    const keys = req.texts.map((t) => createHash('sha256').update(JSON.stringify([req.field, req.extra, t])).digest('hex'));
    const missing = [...new Map(keys.map((k, i) => [k, i]).filter(([k]) => !cache.has(k)).reverse()).values()];
    for (let i = 0; i < missing.length; i += BATCH) {
      const idx = missing.slice(i, i + BATCH);
      const vectors = await workersAi(req.model, { ...req.extra, [req.field]: idx.map((j) => req.texts[j]) });
      if (vectors.length !== idx.length) throw new Error(`Workers AI ${req.model} returned ${vectors.length} vectors for ${idx.length} texts`);
      const lines = idx.map((j, n) => {
        cache.set(keys[j], vectors[n]);
        return JSON.stringify({ k: keys[j], v: Buffer.from(new Float32Array(vectors[n]).buffer).toString('base64') });
      });
      appendFileSync(cacheFile(req.model), `${lines.join('\n')}\n`);
    }
    const data = keys.map((k) => cache.get(k));
    return { shape: [data.length, data[0]?.length ?? 0], data };
  }

  const cacheFile = (m) => path.join(cacheDir, `${m.replace(/[^a-z0-9.-]+/gi, '_')}.jsonl`);

  function loadCache(m) {
    if (caches.has(m)) return caches.get(m);
    const cache = new Map();
    mkdirSync(cacheDir, { recursive: true });
    if (existsSync(cacheFile(m))) {
      for (const line of readFileSync(cacheFile(m), 'utf8').split('\n')) {
        if (!line) continue;
        const { k, v } = JSON.parse(line);
        const buf = Buffer.from(v, 'base64');
        cache.set(k, Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)));
      }
    }
    caches.set(m, cache);
    return cache;
  }

  function report({ meta, records }) {
    const result = { meta: { ...meta, model: model || meta.model, date: new Date().toISOString(), commit: commit(appDir) }, slices: slices(records), records };
    const basePath = path.join(appDir, BASELINE_DIR, 'baseline.json');
    const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
    const md = renderReport(result, base);
    const stamp = result.meta.date.replace(/[:.]/g, '-');
    const name = `${stamp}-${result.meta.mode}${model ? `-${model.replace(/[^a-z0-9.-]+/gi, '_')}` : ''}`;
    const resultsDir = path.join(out, 'results');
    mkdirSync(resultsDir, { recursive: true });
    for (const [file, body] of [[`${name}.json`, JSON.stringify(result, null, 2)], [`${name}.md`, md], ['latest.json', JSON.stringify(result, null, 2)], ['latest.md', md]]) {
      writeFileSync(path.join(file.startsWith('latest') ? out : resultsDir, file), body);
    }
    console.log(`\n${md}\nResults: ${path.join(resultsDir, `${name}.json`)} (+ .md, latest.*)`);
    if (baseline) writeBaseline(appDir, result);
    return { ok: true };
  }

  return async (request) => {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/embed') return Response.json(await embed(await request.json()));
      if (pathname === '/report') return Response.json(report(await request.json()));
      return new Response('not found', { status: 404 });
    } catch (e) {
      return new Response(String(e?.message || e), { status: 500 });
    }
  };
}

/**
 * Which model, field and texts to embed. Without an override the input goes as the code
 * sent it. With one, texts move to the field that model expects: qwen3-embedding tells
 * queries (embedded with its retrieval instruction) from documents; the BGE models take `text`.
 */
export function embeddingRequest(asked, input, phase, override) {
  const field = TEXT_FIELDS.find((f) => input && f in input);
  if (!field) throw new Error(`not an embedding call to ${asked}`);
  const texts = [].concat(input[field]);
  if (!override) {
    const extra = Object.fromEntries(Object.entries(input).filter(([k]) => !TEXT_FIELDS.includes(k)));
    return { model: asked, field, texts, extra };
  }
  const qwen = override.startsWith('@cf/qwen/qwen3-embedding');
  return { model: override, field: qwen ? (phase === 'query' ? 'queries' : 'documents') : 'text', texts, extra: {} };
}

async function workersAi(model, body) {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!account || !token) throw new Error('dense mode needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const data = json.result?.data ?? json.result?.response;
      if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error(`Workers AI ${model}: no embeddings in the response`);
      return data;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`Workers AI ${model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

/** Toy embedding for `--model local-hash`: hashed bag of words. Checks the dense plumbing offline; its scores mean nothing. */
function hashVector(text) {
  const v = new Array(256).fill(0);
  for (const w of text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[(h >>> 0) % 256] += (h >>> 8) & 1 ? 1 : -1;
  }
  const len = Math.hypot(...v) || 1;
  return v.map((x) => x / len);
}

function commit(appDir) {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: appDir, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'tests/fixtures/knowledge-eval'], { cwd: appDir, encoding: 'utf8' }).trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'unknown';
  }
}

/** --baseline: rewrite baseline.json and the generated table inside BASELINE.md (prose around it stays). */
function writeBaseline(appDir, result) {
  const dir = path.join(appDir, BASELINE_DIR);
  writeFileSync(path.join(dir, 'baseline.json'), `${JSON.stringify(baselineOf(result), null, 2)}\n`);
  const mdPath = path.join(dir, 'BASELINE.md');
  const m = result.meta;
  const block = [
    MARK_START,
    `_${m.mode}${m.model ? ` · ${m.model}` : ''} · commit ${m.commit} · ${m.date.slice(0, 10)} · ${m.docs} docs (${m.privateDocs} private to another member) · ${m.chunks} chunks · ${m.questions} questions · top ${result.meta.limit}_`,
    '',
    renderTable(result.slices),
    MARK_END,
  ].join('\n');
  const prev = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : `# Knowledge retrieval baseline\n\n${MARK_START}\n${MARK_END}\n`;
  const at = prev.indexOf(MARK_START);
  const end = prev.indexOf(MARK_END);
  const next = at >= 0 && end > at ? `${prev.slice(0, at)}${block}${prev.slice(end + MARK_END.length)}` : `${prev.trimEnd()}\n\n${block}\n`;
  writeFileSync(mdPath, next);
  console.log(`Baseline written: ${path.join(BASELINE_DIR, 'baseline.json')} + the table in BASELINE.md`);
}
