// Per-account abuse caps (Workstream G). Bounds how much one account can store and
// how many public artifacts it can have, so an open instance can't be turned into a
// storage or spam DoS. Both are instance settings — there are no plans in this build:
//   STORAGE_QUOTA_BYTES      total stored bytes per account (unset/0 = unlimited)
//   PUBLIC_ARTIFACT_LIMIT    public artifacts per account (unset/0 = unlimited)
// Computed on publish (rate-limited 30/hr, so a SUM per publish is cheap) from the
// existing assets table — no separate counter to keep in sync.

import type { Env, FileEntry } from './types';
import { storageQuotaBytes } from './storage-quota';

function publicArtifactLimit(env: Env): number {
  const n = Number.parseInt((env.PUBLIC_ARTIFACT_LIMIT || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Approximate stored byte size of an incoming publish payload. */
export function incomingBytes(files: FileEntry[]): number {
  let total = 0;
  for (const f of files) {
    if (!f.content) continue;
    total += f.encoding === 'base64'
      ? Math.floor((f.content.length * 3) / 4) // base64 -> raw bytes
      : new TextEncoder().encode(f.content).length;
  }
  return total;
}

/** Sum of all stored asset bytes owned by a user (across every artifact/version). */
export async function getOwnerStorageBytes(env: Env, ownerId: string): Promise<number> {
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(ast.size_bytes), 0) AS bytes
    FROM assets ast
    JOIN versions v ON v.id = ast.version_id
    JOIN artifacts a ON a.id = v.artifact_id
    WHERE a.owner_id = ? AND a.deleted_at IS NULL
  `).bind(ownerId).first<{ bytes: number }>();
  return row?.bytes ?? 0;
}

export interface QuotaCheck {
  allowed: boolean;
  used: number;
  incoming: number;
  max: number;
}

/** Check whether `files` would push the owner over the instance storage cap. */
export async function checkStorageQuota(env: Env, ownerId: string, files: FileEntry[]): Promise<QuotaCheck> {
  const max = storageQuotaBytes(env);
  const incoming = incomingBytes(files);
  // max <= 0 means "unbounded" — the default.
  if (max <= 0) return { allowed: true, used: 0, incoming, max };
  const used = await getOwnerStorageBytes(env, ownerId);
  return { allowed: used + incoming <= max, used, incoming, max };
}

/** Count of an owner's currently public artifacts. */
export async function getOwnerPublicArtifactCount(env: Env, ownerId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM artifacts
      WHERE owner_id = ? AND deleted_at IS NULL AND visibility = 'public'`
  ).bind(ownerId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Whether the owner can have one MORE public artifact under the instance cap
 *  (Workstream F3 / anti-abuse). max <= 0 means unbounded — the default. */
export async function canAddPublicArtifact(env: Env, ownerId: string): Promise<{ allowed: boolean; count: number; max: number }> {
  const max = publicArtifactLimit(env);
  if (max <= 0) return { allowed: true, count: 0, max };
  const count = await getOwnerPublicArtifactCount(env, ownerId);
  return { allowed: count < max, count, max };
}
