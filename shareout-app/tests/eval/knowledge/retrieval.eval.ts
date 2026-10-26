// The knowledge retrieval eval — run it with `npm run eval:knowledge`, never part of
// `npm test`. It publishes a synthetic corpus the way people do (pages as deployed
// artifacts, files as workspace Assets, in D1 + R2), learns it with the real ingest code,
// asks every golden question through the real searchCorpus() as a plain workspace member,
// judges the hits and hands them to the Node host (scripts/lib/knowledge-eval-host.mjs) for
// metrics and the report. Retrieval is a black box: whatever chunker, FTS and embedding
// code this branch has is what gets measured. README.md next to this file explains it all.
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { applyMigrations } from '../../unit/helpers/migrated-db';
import { getOrCreateAssetBucket } from '../../../src/assets/bucket';
import { setKnowledgeEnabled } from '../../../src/knowledge';
import { corpusFor, type SourceRow } from '../../../src/knowledge/corpus/client';
import { forceIngest } from '../../../src/knowledge/corpus/ingest';
import { searchCorpus } from '../../../src/knowledge/corpus/search';
import { inSection, loadFixtures, norm } from './golden.mjs';
import { judge, LIMIT } from './metrics.mjs';

interface Doc {
  id: string; title: string; kind: 'file' | 'page'; format: string; genre: string;
  visibility: string; owner: 'author' | 'other' | 'member'; mime: string;
  assets: { path: string; content: string }[];
}
interface Option { doc: string; section: string; evidence: string; scope?: 'section' }
interface Question {
  id: string; q: string; lang: string; type: string; tags: string[]; cluster: string;
  gold: (Option & { alt?: Option[] })[];
}

const raw = import.meta.glob('../../fixtures/knowledge-eval/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, text]) => [p.replace('../../fixtures/knowledge-eval/', ''), text]));

const base = env as unknown as Env & { KNOWLEDGE_EVAL_MODE: 'keyword' | 'dense'; KNOWLEDGE_EVAL_HOST: Fetcher };
const USERS = { author: 'usr_keval_author', other: 'usr_keval_other', member: 'usr_keval_member' } as const;
/** Starvation stress: another member's private copies of every doc the eval member can see. */
const STRESS_COPIES = 2;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Publish docs into a workspace the way the product stores them. Returns refId → doc id. */
async function publish(e: Env, ws: string, tag: string, docs: Doc[]): Promise<Map<string, string>> {
  const refToDoc = new Map<string, string>();
  const bucket = await getOrCreateAssetBucket(e, USERS.author, ws);
  const stmts: D1PreparedStatement[] = [];
  for (const [n, doc] of docs.entries()) {
    const owner = USERS[doc.owner];
    if (doc.kind === 'page') {
      const id = `art_${tag}_${n}`;
      const ver = `ver_${tag}_${n}`;
      const slug = `keval-${tag}-${doc.id}`;
      stmts.push(
        e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)').bind(id, doc.title, slug, owner, doc.visibility, ws),
        e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint) VALUES (?, ?, 1, 'index.html')").bind(ver, id),
        e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${tag}_${n}`, id, ver, slug),
      );
      for (const [i, a] of doc.assets.entries()) {
        const key = `keval/${tag}/${doc.id}/${a.path}`;
        await e.ARTIFACTS.put(key, a.content);
        stmts.push(e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, ?, ?, 'text/html', ?, 'x')")
          .bind(`ast_${tag}_${n}_${i}`, ver, a.path, key, bytes(a.content)));
      }
      refToDoc.set(id, doc.id);
    } else {
      const id = `dlv_${tag}_${n}`;
      const [file] = doc.assets;
      const key = `keval/${tag}/${doc.id}`;
      await e.ARTIFACTS.put(key, file.content);
      stmts.push(
        e.DB.prepare('INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, bucket.id, ws, owner, doc.title, doc.visibility === 'private' ? 'private' : 'workspace'),
        e.DB.prepare('INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
          .bind(`blb_${tag}_${n}`, bucket.id, file.path, doc.mime, key, bytes(file.content), id),
      );
      refToDoc.set(id, doc.id);
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await e.DB.batch(stmts.slice(i, i + 50));
  return refToDoc;
}

/** Learn every source through the real ingest path; every one must come out ready. */
async function learn(e: Env, ws: string, refToDoc: Map<string, string>): Promise<SourceRow[]> {
  await setKnowledgeEnabled(e, ws, true);
  await forceIngest(e, undefined, [...refToDoc.keys()].map((refId) => ({ workspaceId: ws, kind: refId.startsWith('art_') ? 'page' as const : 'asset' as const, refId })));
  // Background indexing runs on the store's alarm (the stemmed-index backfill): finish it
  // before asking anything, or the eval would measure a half-built index.
  const store = corpusFor(e, ws)!;
  for (let i = 0; i < 10_000 && (await runDurableObjectAlarm(store)); i++);
  const backlog = await runInDurableObject(store, (o) => (o as unknown as { stemCursor?: number | null }).stemCursor);
  if (backlog !== undefined && backlog !== null) throw new Error(`${ws}: stemmed index still backfilling (cursor ${backlog})`);
  const { sources } = await store.listSources(10_000);
  const bad = sources.filter((s) => s.status !== 'ready');
  if (bad.length || sources.length !== refToDoc.size) {
    throw new Error(`ingest: ${sources.length - bad.length}/${refToDoc.size} sources ready in ${ws}:\n${bad.map((s) => `  ${refToDoc.get(s.refId)} → ${s.status}${s.error ? ` (${s.error})` : ''}`).join('\n')}`);
  }
  return sources;
}

/** Gold evidence that sits in no learned passage of its doc — a fixture or text-extraction problem. */
async function unreachable(e: Env, ws: string, sources: SourceRow[], refOf: Map<string, string>, questions: Question[]): Promise<string[]> {
  const store = corpusFor(e, ws)!;
  const chunks = new Map<string, { text: string; locator: string }[]>();
  for (const s of sources) {
    const hits = s.chunkCount ? await store.chunksByKey(Array.from({ length: s.chunkCount }, (_, ord) => ({ refId: s.refId, ord }))) : [];
    chunks.set(s.refId, hits.map((h) => ({ text: norm(h.text), locator: h.locator })));
  }
  const problems: string[] = [];
  for (const q of questions) {
    for (const g of q.gold) {
      for (const o of [g, ...(g.alt || [])]) {
        const ok = (chunks.get(refOf.get(o.doc)!) || []).some((c) => c.text.includes(norm(o.evidence)) && (o.scope !== 'section' || inSection(c.locator, o.section)));
        if (!ok) problems.push(`${q.id}: "${o.evidence}" is in no learned passage of ${o.doc}${o.scope === 'section' ? ` located in "${o.section}"` : ''}`);
      }
    }
  }
  return problems;
}

/** In-memory stand-in for the Vectorize index (cosine, like the production index). */
class MemoryVectors {
  private rows = new Map<string, { ns?: string; v: number[]; len: number }>();

  async upsert(vectors: { id: string; values: ArrayLike<number>; namespace?: string }[]) {
    for (const x of vectors) {
      const v = Array.from(x.values);
      this.rows.set(x.id, { ns: x.namespace, v, len: Math.hypot(...v) || 1 });
    }
    return { mutationId: 'keval', count: vectors.length, ids: vectors.map((x) => x.id) };
  }

  async query(vector: ArrayLike<number>, opts: { topK?: number; namespace?: string } = {}) {
    const q = Array.from(vector);
    const qlen = Math.hypot(...q) || 1;
    const matches: { id: string; score: number }[] = [];
    for (const [id, r] of this.rows) {
      if (opts.namespace !== undefined && r.ns !== opts.namespace) continue;
      let dot = 0;
      for (let i = 0; i < r.v.length; i++) dot += r.v[i] * q[i];
      matches.push({ id, score: dot / (r.len * qlen) });
    }
    matches.sort((a, b) => b.score - a.score);
    return { matches: matches.slice(0, opts.topK ?? 5), count: Math.min(matches.length, opts.topK ?? 5) };
  }

  async deleteByIds(ids: string[]) {
    for (const id of ids) this.rows.delete(id);
    return { mutationId: 'keval', count: ids.length, ids };
  }
}

/** Dense mode: embeddings come from the Node host (Workers AI REST + disk cache), vectors live in memory. */
function dense(e: Env) {
  const state = { phase: 'ingest' as 'ingest' | 'query', embedMs: 0, models: new Set<string>(), lastError: '' };
  const AI = {
    async run(model: string, input: Record<string, unknown>) {
      // Only embeddings are wired; the graph extractor's LLM call fails fast and ingest
      // carries on without a graph, which search doesn't use.
      if (!input || !['text', 'documents', 'queries'].some((k) => k in input)) throw new Error(`knowledge eval: ${model} is not wired (embeddings only)`);
      const t0 = performance.now();
      try {
        const res = await base.KNOWLEDGE_EVAL_HOST.fetch('http://keval/embed', { method: 'POST', body: JSON.stringify({ model, input, phase: state.phase }) });
        if (!res.ok) throw new Error(await res.text());
        state.models.add(model);
        return await res.json();
      } catch (err) {
        state.lastError = String((err as Error).message ?? err);
        throw err;
      } finally {
        state.embedMs += performance.now() - t0;
      }
    },
    async toMarkdown() {
      throw new Error('knowledge eval: AI.toMarkdown is not wired — keep fixtures to .md/.txt/.json files and .html pages');
    },
  };
  return { env: { ...e, AI, KNOWLEDGE_VECTORS: new MemoryVectors() } as unknown as Env, state };
}

it('knowledge retrieval eval', async () => {
  const fixtures = loadFixtures(files) as { docs: Doc[]; questions: Question[]; errors: string[] };
  expect(fixtures.errors, 'fixture errors — run `npm run eval:knowledge -- --check`').toEqual([]);
  const { docs, questions } = fixtures;
  const mode = base.KNOWLEDGE_EVAL_MODE;
  const { env: e, state } = mode === 'dense' ? dense(base) : { env: base as Env, state: null };

  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)').bind(
      USERS.author, 'author@keval.example', 'Author', USERS.other, 'other@keval.example', 'Other member', USERS.member, 'member@keval.example', 'Eval member'),
    e.DB.prepare(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('wsp_keval_main', 'Eval', 'keval-main', ?),
      ('wsp_keval_control', 'Eval control', 'keval-control', ?), ('wsp_keval_stress', 'Eval stress', 'keval-stress', ?)`)
      .bind(USERS.author, USERS.author, USERS.author),
  ]);

  // main: every doc, some private to another member. control: only what the member can see —
  // the ideal result list, against which permission starvation is measured. stress: what the
  // member can see plus another member's private copies of all of it, so most passages that
  // match any question are ones the member may not read.
  const t0 = performance.now();
  const visible = docs.filter((d) => d.visibility !== 'private' || d.owner === 'member');
  const copies = Array.from({ length: STRESS_COPIES }, (_, k) =>
    visible.map((d): Doc => ({ ...d, id: `${d.id}--copy${k + 1}`, visibility: 'private', owner: 'other' }))).flat();
  const mainRefs = await publish(e, 'wsp_keval_main', 'main', docs);
  const controlRefs = await publish(e, 'wsp_keval_control', 'ctl', visible);
  const stressRefs = await publish(e, 'wsp_keval_stress', 'str', [...visible, ...copies]);
  const sources = await learn(e, 'wsp_keval_main', mainRefs);
  await learn(e, 'wsp_keval_control', controlRefs);
  await learn(e, 'wsp_keval_stress', stressRefs);
  const ingestMs = performance.now() - t0;

  const refOf = new Map([...mainRefs].map(([ref, doc]) => [doc, ref]));
  const problems = await unreachable(e, 'wsp_keval_main', sources, refOf, questions);
  expect(problems, 'gold evidence missing from the learned passages').toEqual([]);

  if (state) state.phase = 'query';
  const byId = new Map(docs.map((d) => [d.id, d]));
  const records = [];
  let fellBack = 0;
  for (const q of questions) {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const embedBefore = state?.embedMs ?? 0;
    const start = performance.now();
    const main = await searchCorpus(e, 'wsp_keval_main', USERS.member, q.q, { limit: LIMIT, full: true, ctx });
    // Query-embedding time is the provider's (or the cache's), not the search path's.
    const ms = performance.now() - start - ((state?.embedMs ?? 0) - embedBefore);
    const control = await searchCorpus(e, 'wsp_keval_control', USERS.member, q.q, { limit: LIMIT, full: true, ctx });
    const stressEmbed = state?.embedMs ?? 0;
    const stressStart = performance.now();
    const stress = await searchCorpus(e, 'wsp_keval_stress', USERS.member, q.q, { limit: LIMIT, full: true, ctx });
    const stressMs = performance.now() - stressStart - ((state?.embedMs ?? 0) - stressEmbed);
    await Promise.all(pending);
    if (mode === 'dense' && main.mode !== 'hybrid') fellBack++;
    const hits = main.hits.map((h) => ({ doc: mainRefs.get(h.source.id) ?? h.source.id, text: h.text, locator: h.locator }));
    const controlHits = control.hits.map((h) => ({ doc: controlRefs.get(h.source.id) ?? h.source.id, text: h.text, locator: h.locator }));
    const stressHits = stress.hits.map((h) => ({ doc: stressRefs.get(h.source.id) ?? h.source.id, text: h.text, locator: h.locator }));
    const goldDocs = q.gold.map((g) => byId.get(g.doc)!);
    records.push({
      id: q.id, lang: q.lang, type: q.type, tags: q.tags, cluster: q.cluster,
      sources: [...new Set(goldDocs.map((d) => d.format))], genres: [...new Set(goldDocs.map((d) => d.genre))],
      ...judge(q, hits, norm),
      ctlFound: judge(q, controlHits, norm).found,
      stress: { ...judge(q, stressHits, norm), hits: stress.hits.length, ms: stressMs },
      hits: main.hits.length, controlHits: control.hits.length, ms,
      top: hits.slice(0, 10).map((h) => (h.locator ? `${h.doc} § ${h.locator}` : h.doc)),
    });
  }
  expect(fellBack, `dense search fell back to keyword-only (last embedding error: ${state?.lastError || 'none'})`).toBe(0);

  const res = await base.KNOWLEDGE_EVAL_HOST.fetch('http://keval/report', {
    method: 'POST',
    body: JSON.stringify({
      meta: {
        mode, model: state ? [...state.models].join(', ') : '', limit: LIMIT,
        docs: docs.length, privateDocs: docs.length - visible.length, stressCopies: STRESS_COPIES,
        chunks: sources.reduce((n, s) => n + s.chunkCount, 0), questions: questions.length, ingestMs,
      },
      records,
    }),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
});
