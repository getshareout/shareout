/**
 * Turn a workspace's Files into artifacts in place — one document, one artifact, the
 * original kept inside it. Each convertible file is published as a page by its owner, in
 * its folder (the top level when that folder is gone), then the file is soft-deleted with the artifact id recorded on it. A file
 * that a page embeds (/v1/files/{id}) is left alone so no link breaks; one that cannot be
 * converted is marked and skipped until a call with `retry` clears the marks. Bounded per call: callers repeat until
 * `remaining` is 0 (a scan's transcription can take tens of seconds).
 *
 * Safe to repeat while a call is still running (a client that timed out and retried): a file
 * is claimed, with the slug its page will get, before it is transcribed, and a claimed file is
 * left to the call that holds it (`inProgress`). A claim left by a call that died is taken
 * over after CLAIM_STALE_MINUTES under the same slug, so the page it may already have
 * published is reused instead of a second one.
 */
import type { Env } from '../types';
import { convertToPage, isConvertible, newPageSlug } from '../file-imports/convert';

export const TO_ARTIFACTS_MAX_BATCH = 10;
export const CLAIM_STALE_MINUTES = 15;

interface Row {
  id: string; name: string; owner_id: string; email: string | null; folder_id: string | null; visibility: string;
  r2_key: string; filename: string; size_bytes: number; uses: number; claim: string | null;
}

export interface ToArtifactsResult {
  converted: Array<{ id: string; name: string; artifactId: string; slug: string }>;
  kept: Array<{ id: string; name: string; code: string; message: string }>;
  /** Files another call is converting right now; they finish there. */
  inProgress: number;
  remaining: number;
}

export interface ToArtifactsPlan {
  files: Array<{ id: string; name: string; filename: string; sizeBytes: number; convertible: boolean; inUse: boolean }>;
}

const MARK = "json_extract(COALESCE(type_metadata, '{}'), '$.toArtifact')";
const CLAIM = "json_extract(COALESCE(type_metadata, '{}'), '$.toArtifact.claim')";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const STALE = `json_extract(COALESCE(type_metadata, '{}'), '$.toArtifact.at') < strftime('%Y-%m-%dT%H:%M:%fZ','now','-${CLAIM_STALE_MINUTES} minutes')`;
/** Not converted, not kept, not claimed by a live call. */
const OPEN = `(${MARK} IS NULL OR (${CLAIM} IS NOT NULL AND ${STALE}))`;

function selectSql(limit: string): string {
  return `
    SELECT d.id, d.name, d.owner_id, u.email, (SELECT f.id FROM folders f WHERE f.id = d.folder_id) AS folder_id, d.visibility, b.r2_key, b.filename, b.size_bytes,
           (SELECT COUNT(*) FROM file_artifact_usage f WHERE f.deliverable_id = d.id) AS uses, ${CLAIM} AS claim
      FROM asset_deliverables d
      JOIN blobs b ON b.deliverable_id = d.id AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
      LEFT JOIN users u ON u.id = d.owner_id
     WHERE d.workspace_id = ? AND d.deleted_at IS NULL AND ${OPEN}
     ORDER BY d.created_at, d.id ${limit}`;
}

/** Take the file for this call; false when another call holds a live claim (or it is done). */
async function claim(env: Env, id: string, slug: string, previous: string | null): Promise<boolean> {
  const res = await env.DB.prepare(`
    UPDATE asset_deliverables SET type_metadata = json_set(COALESCE(type_metadata, '{}'), '$.toArtifact', json_object('claim', ?, 'at', ${NOW}))
     WHERE id = ? AND deleted_at IS NULL AND ${previous === null ? `${MARK} IS NULL` : `${CLAIM} = ? AND ${STALE}`}
  `).bind(slug, id, ...(previous === null ? [] : [previous])).run();
  return (res.meta?.changes ?? 0) === 1;
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
  const out: ToArtifactsResult = { converted: [], kept: [], inProgress: 0, remaining: 0 };
  const keep = async (r: Row, code: string, message: string) => {
    out.kept.push({ id: r.id, name: r.name, code, message });
    await mark(env, r.id, JSON.stringify({ error: code }), false);
  };

  for (const r of rows) {
    if (r.uses > 0) { await keep(r, 'IN_USE', 'A page links to this file; kept so the link keeps working.'); continue; }
    if (!isConvertible(env, r.filename, r.size_bytes)) { await keep(r, 'NOT_CONVERTIBLE', 'This file type cannot become an artifact.'); continue; }
    const displayName = `${r.name}.${r.filename.split('.').pop()}`;
    const slug = r.claim ?? newPageSlug(displayName);
    if (!(await claim(env, r.id, slug, r.claim))) continue;
    // Taking over a dead call's claim: if it got as far as publishing, that page is the answer.
    const published = r.claim === null ? null : await env.DB.prepare('SELECT id FROM artifacts WHERE display_slug = ? AND workspace_id = ? AND deleted_at IS NULL')
      .bind(slug, workspaceId).first<{ id: string }>();
    if (published) {
      await mark(env, r.id, JSON.stringify(published.id), true);
      out.converted.push({ id: r.id, name: r.name, artifactId: published.id, slug });
      continue;
    }
    const obj = await env.ARTIFACTS.get(r.r2_key);
    if (!obj) { await keep(r, 'FILE_MISSING', 'File content missing from storage.'); continue; }
    const page = await convertToPage(env, {
      user: { id: r.owner_id, email: r.email }, workspaceId, folderId: r.folder_id,
      visibility: r.visibility === 'private' ? 'private' : 'workspace',
      // The page name is the file's name; convertToPage strips an extension, so give it one
      // (else "PG-05 Rev.8" loses ".8").
      filename: r.filename, displayName, bytes: new Uint8Array(await obj.arrayBuffer()), slug,
    });
    if (!page.ok) { await keep(r, page.code, page.message); continue; }
    await mark(env, r.id, JSON.stringify(page.artifactId), true);
    out.converted.push({ id: r.id, name: r.name, artifactId: page.artifactId, slug: page.slug });
  }

  const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${selectSql('')})`).bind(workspaceId).first<{ n: number }>();
  out.remaining = left?.n ?? 0;
  const busy = await env.DB.prepare(`SELECT COUNT(*) AS n FROM asset_deliverables WHERE workspace_id = ? AND deleted_at IS NULL AND ${CLAIM} IS NOT NULL AND NOT ${STALE}`)
    .bind(workspaceId).first<{ n: number }>();
  out.inProgress = busy?.n ?? 0;
  return out;
}
