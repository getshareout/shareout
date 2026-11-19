/**
 * Pages made from the same file, found by the file's content (sha256), never by name: two
 * documents can share a name and differ. The source file of a page is the original an
 * import keeps (type_metadata.source.original), else its entrypoint when the page is the
 * document itself (markdown, csv, pdf, image…). Hand-written HTML pages have no source
 * file and are never grouped. Finding is read-only; removing needs the workspace owner's
 * explicit confirmation and uses the ordinary 30-day trash.
 */
import type { Env } from '../types';
import { RETENTION_DAYS, softDeleteArtifact } from '../artifacts/crud';
import { JSON_IN, jsonList } from '../sql-in';

export interface DuplicatePage { id: string; name: string; slug: string | null; ownerId: string | null; folderId: string | null; createdAt: string }
export interface DuplicateGroup { sha256: string; sizeBytes: number; pages: DuplicatePage[] }

interface Row { id: string; name: string; display_slug: string | null; owner_id: string | null; folder_id: string | null; created_at: string; sha256: string; size_bytes: number }

const SOURCES = `
  SELECT a.id, a.name, a.display_slug, a.owner_id, a.folder_id, a.created_at, s.sha256, s.size_bytes
    FROM artifacts a
    JOIN deployments dp ON dp.artifact_id = a.id AND dp.channel = 'production'
    JOIN versions v ON v.id = dp.version_id
    JOIN assets s ON s.version_id = v.id
     AND s.path = COALESCE(json_extract(a.type_metadata, '$.source.original'), CASE WHEN a.artifact_type <> 'html' THEN v.entrypoint END)
   WHERE a.workspace_id = ? AND a.deleted_at IS NULL`;

/** Every set of two or more live pages in the workspace whose source files are byte-identical. Oldest page first. */
export async function findDuplicatePages(env: Env, workspaceId: string): Promise<DuplicateGroup[]> {
  const rows = (await env.DB.prepare(`
    SELECT * FROM (SELECT x.*, COUNT(*) OVER (PARTITION BY x.sha256) AS n FROM (${SOURCES}) x)
     WHERE n > 1 ORDER BY sha256, created_at, id
  `).bind(workspaceId).all<Row>()).results || [];
  const groups = new Map<string, DuplicateGroup>();
  for (const r of rows) {
    const g = groups.get(r.sha256) ?? { sha256: r.sha256, sizeBytes: r.size_bytes, pages: [] };
    g.pages.push({ id: r.id, name: r.name, slug: r.display_slug, ownerId: r.owner_id, folderId: r.folder_id, createdAt: r.created_at });
    groups.set(r.sha256, g);
  }
  return [...groups.values()];
}

export type RemoveDuplicatesResult =
  | { ok: true; kept: string; removed: Array<{ id: string; recoverableUntil: string }>; retentionDays: number }
  | { ok: false; code: 'NOT_A_DUPLICATE' | 'NOTHING_TO_REMOVE'; message: string };

/**
 * Trash `remove`, keeping `keep`. Every page must be a live page of this workspace with the
 * same source file as `keep`, or nothing is removed. Files that pointed at a removed page now
 * point at the kept one.
 */
export async function removeDuplicatePages(env: Env, workspaceId: string, keep: string, remove: string[]): Promise<RemoveDuplicatesResult> {
  const ids = [...new Set(remove)].filter((id) => id !== keep);
  if (!ids.length) return { ok: false, code: 'NOTHING_TO_REMOVE', message: 'Name at least one page to remove other than the one you keep.' };
  const rows = (await env.DB.prepare(`${SOURCES} AND a.id IN ${JSON_IN}`).bind(workspaceId, jsonList([keep, ...ids])).all<Row>()).results || [];
  const hash = rows.find((r) => r.id === keep)?.sha256;
  const bad = ids.filter((id) => !hash || rows.find((r) => r.id === id)?.sha256 !== hash);
  if (bad.length) return { ok: false, code: 'NOT_A_DUPLICATE', message: `Not a copy of the page you keep: ${bad.join(', ')}. Nothing was removed.` };

  const removed: Array<{ id: string; recoverableUntil: string }> = [];
  for (const id of ids) {
    const slug = (await env.DB.prepare('SELECT slug FROM artifacts WHERE id = ?').bind(id).first<{ slug: string }>())!.slug;
    const deletedAt = await softDeleteArtifact(env, id, slug);
    await env.DB.prepare(`
      UPDATE asset_deliverables SET type_metadata = json_set(type_metadata, '$.toArtifact', ?)
       WHERE workspace_id = ? AND json_extract(type_metadata, '$.toArtifact') = ?
    `).bind(keep, workspaceId, id).run();
    removed.push({ id, recoverableUntil: new Date(Date.parse(deletedAt) + RETENTION_DAYS * 86_400_000).toISOString() });
  }
  return { ok: true, kept: keep, removed, retentionDays: RETENTION_DAYS };
}
