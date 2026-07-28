// File usage graph (work/042 P4): which artifacts reference a File. Populated at publish
// time by scanning a version's text assets for deliverable ids (`so.files.getUrl('dlv_…')`
// and `/v1/files/dlv_…/content` both leave the literal id in the source). Best-effort,
// runs in waitUntil.
import type { Env } from '../types';

const DLV_RE = /dlv_[A-Za-z0-9]+/g;
const MAX_ASSETS = 25;          // bound R2 fetches per publish
const MAX_BYTES_PER_ASSET = 2_000_000;
const TEXT_MIME = /(html|javascript|json|css|text|ecmascript)/i;

/** Rebuild the usage rows for one artifact from its published version's source. */
export async function scanFileUsage(env: Env, artifactId: string, versionId: string): Promise<void> {
  if (!versionId) return;
  const { results: assets } = await env.DB.prepare(
    'SELECT r2_key, mime FROM assets WHERE version_id = ? LIMIT ?'
  ).bind(versionId, MAX_ASSETS).all<{ r2_key: string; mime: string }>();

  const ids = new Set<string>();
  for (const a of assets || []) {
    if (!TEXT_MIME.test(a.mime || '')) continue;
    const obj = await env.ARTIFACTS.get(a.r2_key);
    if (!obj) continue;
    const raw = (await obj.text()).slice(0, MAX_BYTES_PER_ASSET);
    for (const m of raw.matchAll(DLV_RE)) ids.add(m[0]);
  }

  // Keep only ids that are real deliverables (drop coincidental matches).
  let real: string[] = [];
  if (ids.size) {
    const arr = [...ids];
    const { results } = await env.DB.prepare(
      `SELECT id FROM asset_deliverables WHERE id IN (${arr.map(() => '?').join(',')})`
    ).bind(...arr).all<{ id: string }>();
    real = (results || []).map((r) => r.id);
  }

  // Replace this artifact's usage rows wholesale (a removed reference must disappear).
  const stmts = [env.DB.prepare('DELETE FROM file_artifact_usage WHERE artifact_id = ?').bind(artifactId)];
  for (const dlv of real) {
    stmts.push(
      env.DB.prepare('INSERT OR IGNORE INTO file_artifact_usage (deliverable_id, artifact_id) VALUES (?, ?)').bind(dlv, artifactId)
    );
  }
  await env.DB.batch(stmts);
}

export interface FileUsageEntry { artifactId: string; name: string | null; slug: string | null; }

/** Artifacts that reference a File (newest first). */
export async function listFileUsage(env: Env, deliverableId: string): Promise<FileUsageEntry[]> {
  const { results } = await env.DB.prepare(`
    SELECT u.artifact_id, a.name, a.display_slug, a.slug
      FROM file_artifact_usage u
      JOIN artifacts a ON a.id = u.artifact_id AND a.deleted_at IS NULL
     WHERE u.deliverable_id = ?
     ORDER BY u.created_at DESC
  `).bind(deliverableId).all<{ artifact_id: string; name: string | null; display_slug: string | null; slug: string | null }>();
  return (results || []).map((r) => ({ artifactId: r.artifact_id, name: r.name, slug: r.display_slug || r.slug }));
}
