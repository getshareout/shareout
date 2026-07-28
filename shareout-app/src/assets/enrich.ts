// AI enrichment of Files (work/042 P4). On upload / new version, extract the file's text
// (reusing the agent's summarizeFile) and ask the LLM for a one-paragraph summary + tags,
// stored on asset_deliverables.type_metadata.enrichment. Runs async via waitUntil, best-effort.
//
// Guards (in order, cheapest first):
//   1. blobId skip — already enriched THIS version → no-op (dedup + idempotency).
//   2. no AI provider configured → skip silently.
//   3. size cap (metadata only, before any R2 fetch) → status 'unsupported'.
//   4. non-text (summarizeFile stub) → status 'unsupported', no LLM call.
// The write is conditional on the enriched blob still being latest, so a newer version's
// enrichment can never be clobbered by an older in-flight one.
import type { Env } from '../types';
import { summarizeFile } from '../data/files';
import { chatComplete, getAIProvider } from '../data/agent/anthropic';
import { recordAiUsage } from '../data/ai-usage';

// Memory guard is the important one: parseXlsx/arrayBuffer run in the request isolate
// (128MB). Reject on size_bytes BEFORE fetching bytes. ~25MB covers real docs; a 300MB
// upload would OOM the isolate and take down concurrent requests.
const MAX_ENRICH_BYTES = 25_000_000;
const ENRICH_MODEL_LABEL = 'file-enrichment';

const ENRICH_SYSTEM = `You describe an uploaded file for a workspace's file library.
Given extracted text (a spreadsheet schema+sample, slides, or a document), respond with STRICT JSON only:
{"summary": string, "tags": string[]}
- summary: ONE paragraph, <= 400 characters, plain language, what the file IS and contains.
- tags: up to 8 short lowercase keywords (topics, entities, doc type). No # prefix.
No prose outside the JSON.`;

interface EnrichmentMeta {
  status: 'ok' | 'unsupported' | 'failed';
  summary?: string;
  tags?: string[];
  blobId: string;
  model?: string;
  at: string;
}

interface LatestRow {
  workspace_id: string | null;
  owner_id: string | null;
  type_metadata: string | null;
  blob_id: string;
  r2_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

export async function enrichDeliverable(env: Env, bucketId: string, deliverableId: string): Promise<void> {
  const row = await env.DB.prepare(`
    SELECT d.workspace_id, d.owner_id, d.type_metadata,
           b.id AS blob_id, b.r2_key, b.filename, b.mime_type, b.size_bytes
      FROM asset_deliverables d
      JOIN blobs b ON b.deliverable_id = d.id
        AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
     WHERE d.id = ? AND d.bucket_artifact_id = ? AND d.deleted_at IS NULL
  `).bind(deliverableId, bucketId).first<LatestRow>();
  if (!row) return;

  // 1. Already enriched this exact version → nothing to do.
  const existing = parseEnrichment(row.type_metadata);
  if (existing?.blobId === row.blob_id) return;

  // 2. No AI configured → don't churn statuses; a later deploy with AI can backfill.
  if (!getAIProvider(env)) return;

  const now = new Date().toISOString();

  // 3. Too large to parse safely in-isolate → mark unsupported without touching R2.
  if (row.size_bytes > MAX_ENRICH_BYTES) {
    await writeEnrichment(env, deliverableId, { status: 'unsupported', blobId: row.blob_id, at: now });
    return;
  }

  const obj = await env.ARTIFACTS.get(row.r2_key);
  if (!obj) return; // bytes missing — leave unenriched, next version can retry.
  const bytes = await obj.arrayBuffer();
  const text = summarizeFile(bytes, row.filename, row.mime_type);

  // 4. Binary / unreadable (summarizeFile stub) → unsupported, no LLM spend.
  if (!isReadableText(text)) {
    await writeEnrichment(env, deliverableId, { status: 'unsupported', blobId: row.blob_id, at: now });
    return;
  }

  let meta: EnrichmentMeta;
  try {
    const out = await chatComplete(env, [{ role: 'user', content: text }], ENRICH_SYSTEM, 400);
    const parsed = parseModelJson(out);
    meta = parsed
      ? { status: 'ok', summary: parsed.summary, tags: parsed.tags, blobId: row.blob_id, model: ENRICH_MODEL_LABEL, at: now }
      : { status: 'failed', blobId: row.blob_id, at: now };
    // Tracking-only ledger (never debits) — rough token estimate from char counts.
    await recordAiUsage(env, {
      workspaceId: row.workspace_id, userId: row.owner_id,
      kind: 'file_enrichment', model: ENRICH_MODEL_LABEL,
      units: Math.ceil((text.length + out.length) / 4), unitKind: 'tokens',
      baseCostMicroUsd: Math.round((text.length / 4) * 0.0025 + (out.length / 4) * 0.01),
      source: deliverableId,
    }).catch(() => {});
  } catch {
    meta = { status: 'failed', blobId: row.blob_id, at: now };
  }

  await writeEnrichment(env, deliverableId, meta);
}

// Conditional write: only if the blob we enriched is STILL the latest version. A newer
// version landing mid-flight fails this guard, so the older result can't clobber it.
async function writeEnrichment(env: Env, deliverableId: string, meta: EnrichmentMeta): Promise<void> {
  await env.DB.prepare(`
    UPDATE asset_deliverables
       SET type_metadata = json_set(COALESCE(type_metadata, '{}'), '$.enrichment', json(?))
     WHERE id = ?
       AND (SELECT id FROM blobs WHERE deliverable_id = ? ORDER BY version_no DESC LIMIT 1) = ?
  `).bind(JSON.stringify(meta), deliverableId, deliverableId, meta.blobId).run();
}

function parseEnrichment(typeMetadata: string | null): EnrichmentMeta | null {
  if (!typeMetadata) return null;
  try {
    const m = JSON.parse(typeMetadata) as { enrichment?: EnrichmentMeta };
    return m.enrichment ?? null;
  } catch { return null; }
}

// summarizeFile returns "Binary file … cannot be read as text." for unsupported types.
function isReadableText(text: string): boolean {
  return text.trim().length > 0 && !text.includes('cannot be read as text');
}

// Tolerant JSON extraction: the model may wrap the object in prose/fences.
// Exported — also reused by src/publish/auto-summary.ts (same {summary, tags} contract).
export function parseModelJson(out: string): { summary: string; tags: string[] } | null {
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(out.slice(start, end + 1)) as { summary?: unknown; tags?: unknown };
    const summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 600) : '';
    const tags = Array.isArray(obj.tags)
      ? obj.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase().replace(/^#/, '').trim()).filter(Boolean).slice(0, 8)
      : [];
    if (!summary && !tags.length) return null;
    return { summary, tags };
  } catch { return null; }
}
