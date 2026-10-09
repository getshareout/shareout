// Learn an Asset or page version into the workspace corpus: fetch → text → chunks →
// FTS5 (KnowledgeStore) → embeddings (KNOWLEDGE_VECTORS, namespace = workspace).
// Runs as a Workflow (one instance per source version, retried per step) when the
// KNOWLEDGE_INGEST binding exists, else inline in waitUntil — same steps either way.
import type { Env } from '../../types';
import { sha256 } from '../../crypto-utils';
import { extractTextFromHtml } from '../../serve/utils';
import { parsePptx } from '../../data/files/parse-pptx';
import { isKnowledgeEnabled } from '../store';
import { chunkMarkdown } from './chunk';
import { corpusFor, type SourceKind, type SourceMeta } from './client';
import { estimateTokens, meterKnowledge, PRICING } from './usage';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
export const EMBED_BATCH = 50;
// Same isolate-memory guard as assets/enrich.ts: never pull a huge blob into 128MB.
const MAX_SOURCE_BYTES = 25_000_000;

// Workers AI toMarkdown handles these; text and PPTX are read in-Worker.
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
}

export type ExtractResult = { status: 'gone' | 'unsupported' | 'chunked'; chunkCount: number; previousCount: number };

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
  const obj = await env.ARTIFACTS.get(row.r2_key);
  if (!obj) return 'gone';
  return {
    meta: { refId, kind: 'page', version: row.version_id, title: row.name, ownerId: row.owner_id },
    filename: row.entrypoint,
    mime: row.mime,
    bytes: await obj.arrayBuffer(),
  };
}

/** A source's text as markdown, or null when we can't read the format. */
export async function toMarkdown(env: Env, filename: string, mime: string, bytes: ArrayBuffer): Promise<string | null> {
  const lower = filename.toLowerCase();
  if (PLAIN_TEXT.test(lower) || mime.startsWith('text/plain') || mime === 'text/markdown' || mime === 'application/json') {
    return new TextDecoder().decode(bytes);
  }
  if (lower.endsWith('.pptx')) {
    return parsePptx(bytes).map((s) => `## Slide ${s.index}: ${s.title}\n\n${s.lines.join('\n')}`).join('\n\n');
  }
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
      'unsupported', 'File is larger than 25 MB',
    );
    return { status: 'unsupported', chunkCount: 0, previousCount: 0 };
  }
  const markdown = await toMarkdown(env, loaded.filename, loaded.mime, loaded.bytes);
  const chunks = markdown ? chunkMarkdown(markdown) : [];
  if (!chunks.length) {
    await store.setStatus(loaded.meta, 'unsupported', markdown === null ? `Can't read ${loaded.mime} files yet` : 'No text found');
    return { status: 'unsupported', chunkCount: 0, previousCount: 0 };
  }
  const { previousCount } = await store.replaceChunks(loaded.meta, chunks);
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

/** Drop vectors past the new end (a shorter new version), then mark the source ready. */
export async function finishStep(env: Env, p: IngestParams, r: ExtractResult): Promise<void> {
  if (env.KNOWLEDGE_VECTORS && r.previousCount > r.chunkCount) {
    const stale = [];
    for (let ord = r.chunkCount; ord < r.previousCount; ord++) stale.push(vectorId(p.refId, ord));
    for (let i = 0; i < stale.length; i += 1000) await env.KNOWLEDGE_VECTORS.deleteByIds(stale.slice(i, i + 1000));
  }
  // extract + finish, plus one step per embedding batch.
  const steps = 2 + (r.status === 'chunked' && env.AI && env.KNOWLEDGE_VECTORS ? Math.ceil(r.chunkCount / EMBED_BATCH) : 0);
  await meterKnowledge(env, p.workspaceId, 'knowledge_ingest', env.KNOWLEDGE_INGEST
    ? { model: 'workflow', units: steps, unitKind: 'workflow_steps', costMicroUsd: steps * PRICING.workflowStepMicroUsd, source: p.refId }
    : { model: 'inline', units: 1, unitKind: 'runs', costMicroUsd: 0, source: p.refId });
  if (r.status !== 'chunked') return;
  const store = corpusFor(env, p.workspaceId)!;
  const src = await store.getSource(p.refId);
  if (src) await store.setStatus(src, 'ready');
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
    if (r.status === 'chunked') {
      for (let offset = 0; offset < r.chunkCount; offset += EMBED_BATCH) await embedStep(env, p, offset);
    }
    await finishStep(env, p, r);
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
