// Per-workspace storage snapshots.
//
// There is no billing in this build, so nothing here charges anyone: snapshots are
// operational visibility (how much R2/D1 space each workspace occupies) and the cap
// they are compared against is the instance-wide quota from storage-quota.ts.
import type { Env } from './types';
import { getSubjectStorageBytes, storageQuotaBytes } from './storage-quota';
import { createLogger } from './logging';

const GB = 1_073_741_824;

export function bytesToGb(bytes: number): number {
  return Number((bytes / GB).toFixed(2));
}

export function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Bytes over the instance quota (0 when unlimited or under cap). */
export function overCapBytes(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, used - max);
}

/** Snapshot every workspace's storage use. Idempotent per UTC day. */
export async function runStorageSnapshots(env: Env): Promise<{
  workspaces: number;
  overCap: number;
}> {
  const logger = createLogger(env, { scope: 'storage-snapshots', event: 'daily_snapshot' });
  const day = utcDateString();
  const maxBytes = storageQuotaBytes(env);

  const { results: workspaces } = await env.DB.prepare(
    `SELECT id FROM workspaces`
  ).all<{ id: string }>();

  let overCap = 0;

  for (const ws of workspaces) {
    const used = await getSubjectStorageBytes(env, { ownerId: null, workspaceId: ws.id });
    const over = overCapBytes(used, maxBytes);
    if (over > 0) overCap++;

    await env.DB.prepare(
      `INSERT INTO workspace_storage_snapshots
         (workspace_id, snapshot_date, bytes, max_bytes, overage_bytes, tier)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, snapshot_date) DO UPDATE SET
         bytes = excluded.bytes,
         max_bytes = excluded.max_bytes,
         overage_bytes = excluded.overage_bytes,
         tier = excluded.tier`
    ).bind(ws.id, day, used, maxBytes, over, null).run();
  }

  logger.info('storage snapshots done', {
    day,
    workspaces: workspaces.length,
    over_cap: overCap,
  });
  return { workspaces: workspaces.length, overCap };
}

export interface StorageSnapshotRow {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  snapshot_date: string;
  bytes: number;
  max_bytes: number;
  overage_bytes: number;
  tier: string | null;
}

/** Latest snapshot per workspace (for admin). */
export async function listLatestStorageSnapshots(
  env: Env,
  limit = 50,
): Promise<StorageSnapshotRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.workspace_id, s.snapshot_date, s.bytes, s.max_bytes, s.overage_bytes, s.tier,
            w.name AS workspace_name, w.slug AS workspace_slug
     FROM workspace_storage_snapshots s
     JOIN workspaces w ON w.id = s.workspace_id
     WHERE s.snapshot_date = (
       SELECT MAX(s2.snapshot_date) FROM workspace_storage_snapshots s2
       WHERE s2.workspace_id = s.workspace_id
     )
     ORDER BY s.bytes DESC
     LIMIT ?`
  ).bind(limit).all<StorageSnapshotRow>();
  return results ?? [];
}

export async function listOverCapSnapshots(env: Env, limit = 50): Promise<StorageSnapshotRow[]> {
  const day = utcDateString();
  const { results } = await env.DB.prepare(
    `SELECT s.workspace_id, s.snapshot_date, s.bytes, s.max_bytes, s.overage_bytes, s.tier,
            w.name AS workspace_name, w.slug AS workspace_slug
     FROM workspace_storage_snapshots s
     JOIN workspaces w ON w.id = s.workspace_id
     WHERE s.snapshot_date = ? AND s.overage_bytes > 0
     ORDER BY s.overage_bytes DESC
     LIMIT ?`
  ).bind(day, limit).all<StorageSnapshotRow>();
  return results ?? [];
}

/** Live storage for a workspace (same sum as the quota gate uses). */
export async function getWorkspaceStorageLive(env: Env, workspaceId: string): Promise<{
  used: number;
  max: number;
  overage: number;
}> {
  const used = await getSubjectStorageBytes(env, { ownerId: null, workspaceId });
  const max = storageQuotaBytes(env);
  return { used, max, overage: overCapBytes(used, max) };
}
