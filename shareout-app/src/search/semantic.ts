/**
 * Semantic artifact search via Workers AI embeddings + Vectorize.
 *
 * Pipeline: embed(name+description+tags) → upsert to the VECTORIZE index keyed by
 * artifact_id (on publish). Query: embed the question → nearest ids → re-fetch the
 * accessible subset from D1 (Vectorize is NEVER trusted for access control). When
 * the AI/VECTORIZE bindings are absent (local dev) or error, every function degrades
 * gracefully (null / no-op) and callers fall back to keyword search.
 *
 * Workspace pages are also written to the multilingual KNOWLEDGE_VECTORS_V2 index (the
 * workspace's namespace, knowledge/vectors/v2.ts) and searched there once a workspace is
 * covered and reads are cut over; pages outside a workspace stay on VECTORIZE only.
 */
import type { Env } from '../types';
import { listArtifactsForUser } from '../chat-agent/tools/artifacts';
import type { WorkspaceSelection } from '../chat-platforms/types';
import { selectedWorkspace } from '../chat-agent/scope';
import { embedTexts, V1_MODEL } from '../knowledge/vectors/models';
import { artifactIdsV2, artifactText, deleteArtifactV2, writeArtifactV2 } from '../knowledge/vectors/v2';

// The v1 index is not split per workspace, so the caller's nearest artifacts compete with
// everyone's: fetch Vectorize's maximum (100 without values or metadata) before the access cut.
const QUERY_TOPK = 100;

type Accessible = Awaited<ReturnType<typeof listArtifactsForUser>>;

/** Embed one or more strings with the v1 model (VECTORIZE is 768-d); null if AI is unavailable or errors. */
async function embed(env: Env, texts: string[]): Promise<number[][] | null> {
  if (!env.AI || !texts.length) return null;
  try {
    const data = await embedTexts(env, V1_MODEL, texts, 'document');
    return data.length ? data : null;
  } catch {
    return null;
  }
}

interface IndexRow {
  id: string; name: string; description: string | null;
  owner_id: string | null; workspace_id: string | null; visibility: string; tags: string | null;
}

async function loadIndexRow(env: Env, artifactId: string): Promise<IndexRow | null> {
  return env.DB.prepare(`
    SELECT a.id, a.name, a.description, a.owner_id, a.workspace_id, a.visibility,
           (SELECT GROUP_CONCAT(label, char(10)) FROM artifact_tags WHERE artifact_id = a.id) as tags
    FROM artifacts a WHERE a.id = ? AND a.deleted_at IS NULL
  `).bind(artifactId).first<IndexRow>();
}

function vectorOf(row: IndexRow, values: number[]) {
  return {
    id: row.id,
    values,
    metadata: { owner_id: row.owner_id || '', workspace_id: row.workspace_id || '', visibility: row.visibility },
  };
}

/** Embed + upsert a single artifact. Best-effort: no-op when bindings missing. */
export async function indexArtifactVector(env: Env, artifactId: string): Promise<void> {
  if (!env.AI || (!env.VECTORIZE && !env.KNOWLEDGE_VECTORS_V2)) return;
  const row = await loadIndexRow(env, artifactId);
  if (!row) return;
  const text = artifactText(row);
  if (row.workspace_id) await writeArtifactV2(env, row.workspace_id, row.id, text);
  if (!env.VECTORIZE) return;
  const vecs = await embed(env, [text]);
  if (!vecs) return;
  await env.VECTORIZE.upsert([vectorOf(row, vecs[0])]);
}

/** Drop an artifact from the index (on delete). */
export async function removeArtifactVector(env: Env, artifactId: string): Promise<void> {
  await deleteArtifactV2(env, artifactId);
  if (!env.VECTORIZE) return;
  try { await env.VECTORIZE.deleteByIds([artifactId]); } catch { /* best-effort */ }
}

/** Nearest artifact ids for a query, most-similar first; null when unavailable/empty. */
export async function semanticSearchIds(env: Env, query: string, topK = QUERY_TOPK): Promise<string[] | null> {
  if (!env.VECTORIZE || !env.AI || !query.trim()) return null;
  const vecs = await embed(env, [query]);
  if (!vecs) return null;
  try {
    const res = await env.VECTORIZE.query(vecs[0], { topK, returnValues: false, returnMetadata: false });
    const ids = (res.matches || []).map((m) => m.id);
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Semantic search re-projected onto the user's ACCESSIBLE artifacts (access is
 * enforced in D1, not Vectorize). Returns ordered-by-similarity rows, or null to
 * signal the caller to fall back to keyword search.
 */
export async function semanticSearchArtifacts(
  env: Env,
  userId: string,
  query: string,
  opts: { workspaceId?: WorkspaceSelection; limit?: number } = {},
): Promise<Accessible | null> {
  // One workspace selected: its own v2 namespace once covered (and cut over), else v1's global ranking.
  const ws = selectedWorkspace(opts.workspaceId);
  const fromV2 = ws && env.AI && query.trim() ? await artifactIdsV2(env, ws, query, QUERY_TOPK) : null;
  const ids = fromV2 ?? await semanticSearchIds(env, query);
  if (!ids) return null;
  // Access is checked for these candidates themselves, not looked up in the caller's most
  // recent artifacts (an older page they can open would otherwise never come back).
  const accessible = await listArtifactsForUser(env, userId, { limit: ids.length, workspaceId: opts.workspaceId, ids });
  const byId = new Map(accessible.map((a) => [a.id, a]));
  const ordered = ids.map((id) => byId.get(id)).filter((a): a is Accessible[number] => !!a);
  // From v2 nothing readable is "no semantic answer": keyword search takes over.
  if (fromV2 && !ordered.length) return null;
  return ordered.slice(0, opts.limit ?? 24);
}

/** One-time / maintenance backfill: embed every live artifact into the index. */
export async function backfillVectors(env: Env, max = 5000): Promise<{ indexed: number; skipped: number }> {
  if (!env.VECTORIZE || !env.AI) return { indexed: 0, skipped: 0 };
  const rows = (await env.DB.prepare(`
    SELECT a.id, a.name, a.description, a.owner_id, a.workspace_id, a.visibility,
           (SELECT GROUP_CONCAT(label, char(10)) FROM artifact_tags WHERE artifact_id = a.id) as tags
    FROM artifacts a WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT ?
  `).bind(max).all<IndexRow>()).results || [];

  let indexed = 0, skipped = 0;
  const BATCH = 50; // embed many texts per AI call; upsert ≤500/call (we stay well under)
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const vecs = await embed(env, chunk.map(artifactText));
    if (!vecs || vecs.length !== chunk.length) { skipped += chunk.length; continue; }
    await env.VECTORIZE.upsert(chunk.map((r, j) => vectorOf(r, vecs[j])));
    indexed += chunk.length;
  }
  return { indexed, skipped };
}
