/**
 * Turn a workspace's Files into artifacts in place — one document, one artifact, the
 * original kept inside it. Each convertible file is published as a page by its owner, in
 * its folder, then the file is soft-deleted with the artifact id recorded on it. A file
 * that a page embeds (/v1/files/{id}) is left alone so no link breaks; one that cannot be
 * converted is marked and skipped until a call with `retry` clears the marks. Bounded per call: callers repeat until
 * `remaining` is 0 (a scan's transcription can take tens of seconds).
 */
import type { Env } from '../types';
import { convertToPage, isConvertible } from '../file-imports/convert';

export const TO_ARTIFACTS_MAX_BATCH = 10;

interface Row {
  id: string; name: string; owner_id: string; email: string | null; folder_id: string | null; visibility: string;
  r2_key: string; filename: string; size_bytes: number; uses: number;
}

export interface ToArtifactsResult {
  converted: Array<{ id: string; name: string; artifactId: string; slug: string }>;
  kept: Array<{ id: string; name: string; code: string; message: string }>;
  remaining: number;
}

export interface ToArtifactsPlan {
  files: Array<{ id: string; name: string; filename: string; sizeBytes: number; convertible: boolean; inUse: boolean }>;
}

function selectSql(limit: string): string {
  return `
    SELECT d.id, d.name, d.owner_id, u.email, d.folder_id, d.visibility, b.r2_key, b.filename, b.size_bytes,
           (SELECT COUNT(*) FROM file_artifact_usage f WHERE f.deliverable_id = d.id) AS uses
      FROM asset_deliverables d
      JOIN blobs b ON b.deliverable_id = d.id AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
      LEFT JOIN users u ON u.id = d.owner_id
     WHERE d.workspace_id = ? AND d.deleted_at IS NULL
       AND json_extract(COALESCE(d.type_metadata, '{}'), '$.toArtifact') IS NULL
     ORDER BY d.created_at, d.id ${limit}`;
}

async function mark(env: Env, id: string, value: string, done: boolean): Promise<void> {
  await env.DB.prepare(`
    UPDATE asset_deliverables SET type_metadata = json_set(COALESCE(type_metadata, '{}'), '$.toArtifact', json(?))${done ? `, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')` : ''}
     WHERE id = ?
  `).bind(value, id).run();
}

export async function planFilesToArtifacts(env: Env, workspaceId: string): Promise<ToArtifactsPlan> {
  const rows = (await env.DB.prepare(selectSql('')).bind(workspaceId).all<Row>()).results || [];
  return {
    files: rows.map((r) => ({
      id: r.id, name: r.name, filename: r.filename, sizeBytes: r.size_bytes,
      convertible: isConvertible(env, r.filename, r.size_bytes), inUse: r.uses > 0,
    })),
  };
}

export async function filesToArtifacts(env: Env, workspaceId: string, opts: { limit?: number; retry?: boolean } = {}): Promise<ToArtifactsResult> {
  const limit = Math.max(1, Math.min(TO_ARTIFACTS_MAX_BATCH, opts.limit ?? 3));
  if (opts.retry) {
    await env.DB.prepare(`
      UPDATE asset_deliverables SET type_metadata = json_remove(type_metadata, '$.toArtifact')
       WHERE workspace_id = ? AND deleted_at IS NULL AND json_extract(type_metadata, '$.toArtifact.error') IS NOT NULL
    `).bind(workspaceId).run();
  }
  const rows = (await env.DB.prepare(selectSql('LIMIT ?')).bind(workspaceId, limit).all<Row>()).results || [];
  const out: ToArtifactsResult = { converted: [], kept: [], remaining: 0 };
  const keep = async (r: Row, code: string, message: string) => {
    out.kept.push({ id: r.id, name: r.name, code, message });
    await mark(env, r.id, JSON.stringify({ error: code }), false);
  };

  for (const r of rows) {
    if (r.uses > 0) { await keep(r, 'IN_USE', 'A page links to this file; kept so the link keeps working.'); continue; }
    if (!isConvertible(env, r.filename, r.size_bytes)) { await keep(r, 'NOT_CONVERTIBLE', 'This file type cannot become an artifact.'); continue; }
    const obj = await env.ARTIFACTS.get(r.r2_key);
    if (!obj) { await keep(r, 'FILE_MISSING', 'File content missing from storage.'); continue; }
    const page = await convertToPage(env, {
      user: { id: r.owner_id, email: r.email }, workspaceId, folderId: r.folder_id,
      visibility: r.visibility === 'private' ? 'private' : 'workspace',
      filename: r.filename, displayName: r.name, bytes: new Uint8Array(await obj.arrayBuffer()), slug: null,
    });
    if (!page.ok) { await keep(r, page.code, page.message); continue; }
    await mark(env, r.id, JSON.stringify(page.artifactId), true);
    out.converted.push({ id: r.id, name: r.name, artifactId: page.artifactId, slug: page.slug });
  }

  const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${selectSql('')})`).bind(workspaceId).first<{ n: number }>();
  out.remaining = left?.n ?? 0;
  return out;
}
