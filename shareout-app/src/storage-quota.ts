// Per-workspace storage cap (work/031 follow-on). Without a gate a single workspace
// could fill R2 unbounded — the "what if a workspace hosts 500TB?" risk. This enforces
// the instance's storage budget at the write path (dataset confirm/upload + materialize).
//
// There are no plans in this build, so the caps are instance-wide operator settings:
//   STORAGE_QUOTA_BYTES     total bytes per subject (unset/0 = unlimited)
//   STORAGE_MAX_FILE_BYTES  single-file cap (unset/0 = unlimited)
//
// Subject = the workspace when the artifact belongs to one, else the owner's
// personal (workspace_id IS NULL) footprint. Bytes are summed live from the existing
// size columns — assets.size_bytes + datasets.size_bytes + artifact_storage.used_bytes
// (blobs) — so there's no counter to keep in sync. Writes are infrequent relative to reads,
// so a SUM-per-write is cheap.

import type { Env } from './types';

function envBytes(raw: string | undefined): number {
  const n = Number.parseInt((raw || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Instance-wide storage cap per subject, in bytes. 0 = unlimited. */
export function storageQuotaBytes(env: Env): number {
  return envBytes(env.STORAGE_QUOTA_BYTES);
}

/** Instance-wide single-file cap, in bytes. 0 = unlimited. */
export function storageMaxFileBytes(env: Env): number {
  return envBytes(env.STORAGE_MAX_FILE_BYTES);
}

export interface StorageSubject {
  ownerId: string | null;
  workspaceId: string | null;
}

async function artifactSubject(env: Env, artifactId: string): Promise<StorageSubject | null> {
  const row = await env.DB.prepare(
    'SELECT owner_id, workspace_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ owner_id: string | null; workspace_id: string | null }>();
  if (!row) return null;
  return { ownerId: row.owner_id, workspaceId: row.workspace_id };
}

// Scope artifacts to the billing subject: a workspace if present, else the owner's
// personal artifacts (those not in any workspace), so the two never double-count.
function subjectFilter(s: StorageSubject): { clause: string; bind: string } {
  if (s.workspaceId) return { clause: 'a.workspace_id = ?', bind: s.workspaceId };
  return { clause: 'a.owner_id = ? AND a.workspace_id IS NULL', bind: s.ownerId ?? '' };
}

/** Total stored bytes for a subject across assets + datasets + blobs. */
export async function getSubjectStorageBytes(env: Env, s: StorageSubject): Promise<number> {
  const f = subjectFilter(s);
  const sum = (sql: string) =>
    env.DB.prepare(sql).bind(f.bind).first<{ bytes: number }>();

  const [assets, datasets, blobs] = await Promise.all([
    sum(`SELECT COALESCE(SUM(ast.size_bytes), 0) AS bytes
           FROM assets ast
           JOIN versions v ON v.id = ast.version_id
           JOIN artifacts a ON a.id = v.artifact_id
          WHERE ${f.clause} AND a.deleted_at IS NULL`),
    sum(`SELECT COALESCE(SUM(d.size_bytes), 0) AS bytes
           FROM datasets d
           JOIN artifacts a ON a.id = d.artifact_id
          WHERE ${f.clause} AND a.deleted_at IS NULL`),
    sum(`SELECT COALESCE(SUM(st.used_bytes), 0) AS bytes
           FROM artifact_storage st
           JOIN artifacts a ON a.id = st.artifact_id
          WHERE ${f.clause} AND a.deleted_at IS NULL`),
  ]);

  return (assets?.bytes ?? 0) + (datasets?.bytes ?? 0) + (blobs?.bytes ?? 0);
}

export type StorageQuotaReason = 'ok' | 'file_too_large' | 'over_quota';

export interface StorageQuotaResult {
  allowed: boolean;
  reason: StorageQuotaReason;
  used: number;
  incoming: number;
  max: number;      // instance total-storage cap (0 = unbounded)
  fileMax: number;  // instance per-file cap (0 = unbounded)
}

/**
 * Whether writing `incomingBytes` more bytes for `artifactId`'s subject stays within the
 * instance's per-file and total-storage caps. Rejects oversized single files before the
 * total check so the caller can show the right message.
 */
export async function checkStorageQuota(
  env: Env,
  artifactId: string,
  incomingBytes: number,
  replacingBytes = 0
): Promise<StorageQuotaResult> {
  const subject = await artifactSubject(env, artifactId);
  const max = storageQuotaBytes(env);
  const fileMax = storageMaxFileBytes(env);

  if (fileMax > 0 && incomingBytes > fileMax) {
    return { allowed: false, reason: 'file_too_large', used: 0, incoming: incomingBytes, max, fileMax };
  }
  if (max <= 0) {
    return { allowed: true, reason: 'ok', used: 0, incoming: incomingBytes, max, fileMax };
  }

  const used = subject ? await getSubjectStorageBytes(env, subject) : 0;
  // On replace the old bytes are still in `used` but will be overwritten, so only the net
  // delta counts toward the cap.
  if (used - replacingBytes + incomingBytes > max) {
    return { allowed: false, reason: 'over_quota', used, incoming: incomingBytes, max, fileMax };
  }
  return { allowed: true, reason: 'ok', used, incoming: incomingBytes, max, fileMax };
}

function fmtBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}GB`;
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}MB`;
  return `${Math.round(n / 1000)}KB`;
}

/** Maps a failed quota result to the user-facing error body (shared by datasets + blobs). */
export function storageQuotaError(q: StorageQuotaResult): {
  code: string; message: string; status: number; hint: string; suggestion: string;
} {
  if (q.reason === 'file_too_large') {
    return {
      code: 'FILE_TOO_LARGE',
      message: `File exceeds this instance's ${fmtBytes(q.fileMax)} per-file limit`,
      status: 413,
      hint: `This file is ${fmtBytes(q.incoming)}; the instance caps a single file at ${fmtBytes(q.fileMax)}.`,
      suggestion: 'Split the upload into smaller files, or raise STORAGE_MAX_FILE_BYTES.',
    };
  }
  return {
    code: 'STORAGE_QUOTA_EXCEEDED',
    message: `Storage limit reached for this instance (${fmtBytes(q.max)})`,
    status: 507,
    hint: `Using ${fmtBytes(q.used)} of ${fmtBytes(q.max)}; this ${fmtBytes(q.incoming)} upload would exceed it.`,
    suggestion: 'Delete unused data, or raise STORAGE_QUOTA_BYTES on the Worker.',
  };
}
