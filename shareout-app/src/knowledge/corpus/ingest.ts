// Learn an Asset or page version into the workspace corpus: fetch → text → chunks →
// FTS5 (KnowledgeStore) → embeddings (KNOWLEDGE_VECTORS, namespace = workspace).
// Runs as a Workflow (one instance per source version, retried per step) when the
// KNOWLEDGE_INGEST binding exists, else inline in waitUntil — same steps either way.
import type { Env, TypeMetadata } from '../../types';
import { sha256 } from '../../crypto-utils';
import { extractTextFromHtml } from '../../serve/utils';
import { parsePptx } from '../../data/files/parse-pptx';
import { DocReadError, docToMarkdown } from '../../data/files/parse-doc';
import { isKnowledgeEnabled } from '../store';
import { chunkMarkdown, MAX_CHUNKS, type Chunk } from './chunk';
import { CHUNKER_VERSION, chunkSections, htmlSections } from './sections';
import { corpusFor, type SourceKind, type SourceMeta } from './client';
import { estimateTokens, meterKnowledge, PRICING } from './usage';
import { EXTRACT_BATCH, extractBatch } from './extract';
import { workspaceBudgetBlock } from '../../data/ai-budget';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
export const EMBED_BATCH = 50;
// Same isolate-memory guard as assets/enrich.ts: never pull a huge blob into 128MB.
const MAX_SOURCE_BYTES = 25_000_000;

// Workers AI toMarkdown handles these; text, PPTX and legacy Word (.doc) are read in-Worker.
const TO_MARKDOWN = /\.(pdf|docx|odt|xlsx|xlsm|xlsb|xls|ods|numbers|csv|html?|xml|jpe?g|png|webp|svg|gif|bmp)$/i;
const PLAIN_TEXT = /\.(txt|md|markdown|json)$/i;

export interface IngestParams {
  workspaceId: string;
  kind: SourceKind;
  refId: string;
}

interface Loaded {
  meta: SourceMeta;
  filename: string;
  mime: string;
  bytes: ArrayBuffer;
  /** A published HTML page: chunk it by section, across every HTML page of its version. */
  site?: { versionId: string; entrypoint: string };
}

// A multi-page site is learned page by page (procedures index + one page per procedure).
const MAX_SITE_PAGES = 60;
const MAX_PAGE_CHARS = 2_000_000;

export type ExtractResult = { status: 'gone' | 'unsupported' | 'chunked' | 'deferred'; chunkCount: number; previousCount: number };

async function loadAsset(env: Env, workspaceId: string, refId: string): Promise<Loaded | 'gone' | 'too_big'> {
  const row = await env.DB.prepare(`
    SELECT d.name, d.owner_id, b.id AS blob_id, b.r2_key, b.filename, b.mime_type, b.size_bytes
      FROM asset_deliverables d
      JOIN blobs b ON b.deliverable_id = d.id
       AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
     WHERE d.id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL
  `).bind(refId, workspaceId).first<{
    name: string; owner_id: string; blob_id: string; r2_key: string; filename: string; mime_type: string; size_bytes: number;
  }>();
  if (!row) return 'gone';
  const meta: SourceMeta = { refId, kind: 'asset', version: row.blob_id, title: row.name, ownerId: row.owner_id };
  if (row.size_bytes > MAX_SOURCE_BYTES) return 'too_big';
  const obj = await env.ARTIFACTS.get(row.r2_key);
  if (!obj) return 'gone';
  return { meta, filename: row.filename, mime: row.mime_type, bytes: await obj.arrayBuffer() };
}

function importedWorkbookOriginal(typeMetadata: string | null): string | null {
  try {
    const src = (JSON.parse(typeMetadata || '{}') as TypeMetadata).source;
    return src?.sheets?.length ? src.original : null;
  } catch { return null; }
}

async function loadPage(env: Env, workspaceId: string, refId: string): Promise<Loaded | 'gone'> {
  const row = await env.DB.prepare(`
    SELECT a.name, a.owner_id, dep.version_id, s.r2_key, s.mime, v.entrypoint
      FROM artifacts a
      JOIN deployments dep ON dep.artifact_id = a.id AND dep.channel = 'production'
      JOIN versions v ON v.id = dep.version_id
      JOIN assets s ON s.version_id = dep.version_id AND s.path = v.entrypoint
     WHERE a.id = ? AND a.workspace_id = ? AND a.deleted_at IS NULL
  `).bind(refId, workspaceId).first<{
    name: string; owner_id: string; version_id: string; r2_key: string; mime: string; entrypoint: string;
  }>();
  if (!row) return 'gone';
  // An imported workbook's entrypoint is only its first sheet: learn the original file
  // (every sheet, via toMarkdown) — the same text it would give as an Asset.
  let file = { path: row.entrypoint, r2_key: row.r2_key, mime: row.mime };
  const sourceFile = env.AI
    ? importedWorkbookOriginal((await env.DB.prepare('SELECT type_metadata FROM artifacts WHERE id = ?').bind(refId).first<{ type_metadata: string | null }>())?.type_metadata ?? null)
    : null;
  if (sourceFile) {
    const orig = await env.DB.prepare('SELECT r2_key, mime, size_bytes FROM assets WHERE version_id = ? AND path = ?')
      .bind(row.version_id, sourceFile).first<{ r2_key: string; mime: string; size_bytes: number }>();
    if (orig && orig.size_bytes <= MAX_SOURCE_BYTES && TO_MARKDOWN.test(sourceFile)) file = { path: sourceFile, r2_key: orig.r2_key, mime: orig.mime };
  }
  const obj = await env.ARTIFACTS.get(file.r2_key);
  if (!obj) return 'gone';
  return {
    meta: { refId, kind: 'page', version: row.version_id, title: row.name, ownerId: row.owner_id },
    filename: file.path.split('/').pop()!,
    mime: file.mime,
    bytes: await obj.arrayBuffer(),
    ...(!sourceFile && file.mime.includes('html') ? { site: { versionId: row.version_id, entrypoint: row.entrypoint } } : {}),
  };
}

/** Section chunks for a published HTML page and its sibling HTML pages (entrypoint first). */
async function siteChunks(env: Env, loaded: Loaded): Promise<Chunk[]> {
  const { versionId, entrypoint } = loaded.site!;
  const rows = (await env.DB.prepare(
    "SELECT path, r2_key FROM assets WHERE version_id = ? AND mime = 'text/html' AND path != ? ORDER BY path LIMIT ?",
  ).bind(versionId, entrypoint, MAX_SITE_PAGES - 1).all<{ path: string; r2_key: string }>()).results || [];
  const chunks: Chunk[] = [];
  const add = (path: string | null, html: string) => {
    if (html.length > MAX_PAGE_CHARS) html = html.slice(0, MAX_PAGE_CHARS);
    chunks.push(...chunkSections(htmlSections(html), { startOrd: chunks.length, page: path, max: MAX_CHUNKS - chunks.length }));
  };
  add(null, new TextDecoder().decode(loaded.bytes));
  for (const r of rows) {
    if (chunks.length >= MAX_CHUNKS) break;
    const obj = await env.ARTIFACTS.get(r.r2_key);
    if (obj) add(r.path, await obj.text());
  }
  return chunks;
}

/**
 * A source's text as markdown, or null when we can't read the format. Throws DocReadError
 * (a reader-facing reason) when a .doc is damaged, protected or too old to read.
 */
export async function toMarkdown(env: Env, filename: string, mime: string, bytes: ArrayBuffer): Promise<string | null> {
  const lower = filename.toLowerCase();
  if (PLAIN_TEXT.test(lower) || mime.startsWith('text/plain') || mime === 'text/markdown' || mime === 'application/json') {
    return new TextDecoder().decode(bytes);
  }
  if (lower.endsWith('.pptx')) {
    return parsePptx(bytes).map((s) => `## Slide ${s.index}: ${s.title}\n\n${s.lines.join('\n')}`).join('\n\n');
  }
  if (lower.endsWith('.doc') || mime === 'application/msword') return docToMarkdown(new Uint8Array(bytes));
  const isHtml = mime.includes('html') || /\.html?$/.test(lower);
  if (env.AI && TO_MARKDOWN.test(lower)) {
    const res = await env.AI.toMarkdown({ name: filename, blob: new Blob([bytes], { type: mime }) });
    if (res.format === 'markdown' && res.data.trim()) return res.data;
  }
  if (isHtml) return extractTextFromHtml(new TextDecoder().decode(bytes));
  return null;
}

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const res = (await env.AI!.run(EMBED_MODEL, { text: texts })) as { data?: number[][] };
  if (!res.data || res.data.length !== texts.length) throw new Error('embedding failed');
  return res.data;
}

const vectorId = (refId: string, ord: number) => `${refId}:${ord}`;

export async function extractStep(env: Env, p: IngestParams): Promise<ExtractResult> {
  const store = corpusFor(env, p.workspaceId)!;
  const loaded = p.kind === 'asset' ? await loadAsset(env, p.workspaceId, p.refId) : await loadPage(env, p.workspaceId, p.refId);
  if (loaded === 'gone') {
    const { previousCount } = await store.removeSource(p.refId);
    return { status: 'gone', chunkCount: 0, previousCount };
  }
  if (loaded === 'too_big') {
    const src = await store.getSource(p.refId);
    await store.setStatus(
      { refId: p.refId, kind: 'asset', version: 'too_big', title: src?.title ?? p.refId, ownerId: src?.ownerId ?? null },
      'unsupported', 'File is larger than 25 MB', CHUNKER_VERSION,
    );
    return { status: 'unsupported', chunkCount: 0, previousCount: 0 };
  }
  // Over the workspace's monthly AI budget: spend nothing, keep the source queued ('processing', chunker 0)
  // so the nightly refresh re-learns it once the budget is raised or the month turns. Never 'failed'.
  if (await workspaceBudgetBlock(env, p.workspaceId)) {
    await store.setStatus(loaded.meta, 'processing', BUDGET_WAIT, 0);
    return { status: 'deferred', chunkCount: 0, previousCount: 0 };
  }
  let markdown: string | null;
  try {
    markdown = loaded.site ? '' : await toMarkdown(env, loaded.filename, loaded.mime, loaded.bytes);
  } catch (e) {
    if (!(e instanceof DocReadError)) throw e;
    await store.setStatus(loaded.meta, 'unsupported', e.message, CHUNKER_VERSION);
    return { status: 'unsupported', chunkCount: 0, previousCount: 0 };
  }
  const chunks = loaded.site ? await siteChunks(env, loaded) : markdown ? chunkMarkdown(markdown) : [];
  if (!chunks.length) {
    await store.setStatus(loaded.meta, 'unsupported', markdown === null ? `Can't read ${loaded.mime} files yet` : 'No text found', CHUNKER_VERSION);
    return { status: 'unsupported', chunkCount: 0, previousCount: 0 };
  }
  const { previousCount } = await store.replaceChunks(loaded.meta, chunks, CHUNKER_VERSION);
  return { status: 'chunked', chunkCount: chunks.length, previousCount };
}

export async function embedStep(env: Env, p: IngestParams, offset: number): Promise<number> {
  if (!env.AI || !env.KNOWLEDGE_VECTORS) return 0;
  const rows = await corpusFor(env, p.workspaceId)!.chunkTexts(p.refId, offset, EMBED_BATCH);
  if (!rows.length) return 0;
  const texts = rows.map((r) => r.text.slice(0, 2000));
  const values = await embed(env, texts);
  await env.KNOWLEDGE_VECTORS.upsert(
    rows.map((r, i) => ({ id: vectorId(p.refId, r.ord), values: values[i], namespace: p.workspaceId })),
  );
  const tokens = estimateTokens(texts);
  await meterKnowledge(env, p.workspaceId, 'knowledge_embedding', {
    model: EMBED_MODEL, units: tokens, unitKind: 'tokens', costMicroUsd: tokens * PRICING.embedTokenMicroUsd, source: p.refId,
  });
  return rows.length;
}

const KNOWN_ENTITIES = 60;
const BUDGET_WAIT = 'Waiting for the monthly AI budget';
/** graphStep result when the workspace budget is spent: the graph for this source is left to the next refresh. */
export const GRAPH_DEFERRED = -1;

/** Extract entities/relations/facts from one batch of chunks into the graph. */
export async function graphStep(env: Env, p: IngestParams, offset: number): Promise<number> {
  if (!env.AI) return 0;
  if (await workspaceBudgetBlock(env, p.workspaceId)) return GRAPH_DEFERRED;
  const store = corpusFor(env, p.workspaceId)!;
  const chunks = await store.chunkTexts(p.refId, offset, EXTRACT_BATCH);
  if (!chunks.length) return 0;
  const known = await store.knownEntities(KNOWN_ENTITIES);
  const x = await extractBatch(env, p.workspaceId, p.refId, chunks, known);
  const r = await store.applyExtraction(p.refId, x);
  return r.entities + r.relations + r.facts;
}

/** Workflow steps one ingest takes: extract + finish, plus graph and embedding batches. */
export function ingestSteps(env: Env, chunkCount: number): number {
  if (!chunkCount) return 2;
  return 2 + (env.AI ? Math.ceil(chunkCount / EXTRACT_BATCH) : 0) + (env.AI && env.KNOWLEDGE_VECTORS ? Math.ceil(chunkCount / EMBED_BATCH) : 0);
}

/** Drop vectors past the new end (a shorter new version), then mark the source ready. */
export async function finishStep(env: Env, p: IngestParams, r: ExtractResult, graphDeferred = false): Promise<void> {
  if (r.status === 'deferred') return;
  if (env.KNOWLEDGE_VECTORS && r.previousCount > r.chunkCount) {
    const stale = [];
    for (let ord = r.chunkCount; ord < r.previousCount; ord++) stale.push(vectorId(p.refId, ord));
    // Vectorize takes at most 100 ids per delete (error 40007 past that).
    for (let i = 0; i < stale.length; i += 100) await env.KNOWLEDGE_VECTORS.deleteByIds(stale.slice(i, i + 100));
  }
  const steps = ingestSteps(env, r.status === 'chunked' ? r.chunkCount : 0);
  await meterKnowledge(env, p.workspaceId, 'knowledge_ingest', env.KNOWLEDGE_INGEST
    ? { model: 'workflow', units: steps, unitKind: 'workflow_steps', costMicroUsd: steps * PRICING.workflowStepMicroUsd, source: p.refId }
    : { model: 'inline', units: 1, unitKind: 'runs', costMicroUsd: 0, source: p.refId });
  if (r.status !== 'chunked') return;
  const store = corpusFor(env, p.workspaceId)!;
  const src = await store.getSource(p.refId);
  if (src) await (graphDeferred ? store.setStatus(src, 'processing', BUDGET_WAIT, 0) : store.setStatus(src, 'ready'));
}

export async function markFailed(env: Env, p: IngestParams, err: unknown): Promise<void> {
  const store = corpusFor(env, p.workspaceId)!;
  const src = await store.getSource(p.refId);
  await store.setStatus(
    src ?? { refId: p.refId, kind: p.kind, version: 'unknown', title: p.refId, ownerId: null },
    'failed', String((err as Error)?.message ?? err).slice(0, 300),
  );
}

export async function ingestInline(env: Env, p: IngestParams): Promise<void> {
  try {
    const r = await extractStep(env, p);
    let graphDeferred = false;
    if (r.status === 'chunked') {
      for (let offset = 0; offset < r.chunkCount; offset += EXTRACT_BATCH) {
        // The graph is best-effort: a failed batch never blocks search.
        if ((await graphStep(env, p, offset).catch(() => 0)) === GRAPH_DEFERRED) { graphDeferred = true; break; }
      }
      for (let offset = 0; offset < r.chunkCount; offset += EMBED_BATCH) await embedStep(env, p, offset);
    }
    await finishStep(env, p, r, graphDeferred);
  } catch (err) {
    await markFailed(env, p, err);
  }
}

/**
 * Queue a source to be (re)learned. `version` makes it idempotent: the same version
 * maps to the same Workflow instance id, so a re-publish of identical content is free.
 * No-op unless Knowledge is on for the workspace and the store binding exists.
 */
export async function queueKnowledgeSource(
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  p: IngestParams,
  version: string,
): Promise<boolean> {
  if (!env.KNOWLEDGE_STORE || !(await isKnowledgeEnabled(env, p.workspaceId))) return false;
  await startIngest(env, ctx, p, version, true);
  return true;
}

/** A page was deleted, purged or restored: re-check it, so a page that's gone is forgotten. */
export function relearnPage(env: Env, workspaceId: string | null, refId: string, version: string): Promise<boolean> {
  if (!workspaceId) return Promise.resolve(false);
  return queueKnowledgeSource(env, undefined, { workspaceId, kind: 'page', refId }, version).catch(() => false);
}

/** Start ingest for a source the caller already gated. `checkExisting` looks the
 *  instance up first; skip it when the caller knows the version is new. */
export async function startIngest(
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  p: IngestParams,
  version: string,
  checkExisting: boolean,
): Promise<void> {
  if (env.KNOWLEDGE_INGEST) {
    const id = `${p.refId}-${(await sha256(new TextEncoder().encode(version).buffer as ArrayBuffer)).slice(0, 16)}`;
    // An existing instance means this exact version is already queued or learned.
    if (checkExisting && (await env.KNOWLEDGE_INGEST.get(id).then(() => true, () => false))) return;
    await env.KNOWLEDGE_INGEST.create({ id, params: p });
    return;
  }
  const run = ingestInline(env, p);
  if (ctx) ctx.waitUntil(run);
  else await run;
}

const INLINE_CONCURRENCY = 3;

/**
 * Re-learn sources even when their version is unchanged (reindex, nightly refresh).
 * A fresh Workflow instance id per call bypasses the same-version dedupe; inline, at
 * most INLINE_CONCURRENCY run at once, in waitUntil when there is a ctx, else awaited.
 */
export async function forceIngest(
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  items: IngestParams[],
): Promise<void> {
  if (!items.length) return;
  if (env.KNOWLEDGE_INGEST) {
    const stamp = Date.now();
    for (const p of items) {
      await startIngest(env, ctx, p, `force:${stamp}`, false).catch((err) => markFailed(env, p, err));
    }
    return;
  }
  const queue = [...items];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) await ingestInline(env, p);
  };
  const run = Promise.all(Array.from({ length: Math.min(INLINE_CONCURRENCY, items.length) }, worker));
  if (ctx) ctx.waitUntil(run);
  else await run;
}
