/**
 * Workspace / personal asset bucket.
 *
 * The asset library is backed by a single hidden artifact per scope: a
 * workspace's shared bucket, or a user's personal bucket (workspace_id IS NULL).
 * Files uploaded to it reuse the entire per-artifact blob pipeline (R2, presign,
 * storage tracking).
 *
 * Buckets are flagged by the `asset_buckets` table (migration 0104) rather than a
 * new artifact_type — the artifacts CHECK constraint can't be extended on D1. The
 * bucket is `public` so its blob bytes serve from stable public URLs (reuse across
 * artifacts + WeTransfer-style delivery links). It stays hidden despite being
 * public: it carries no HTML deployment (so it's never in the workspace index and
 * the bucket "page" itself is never served — only its blobs) and is excluded from
 * the home grid by id (see homeScopeSql).
 */
import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { createMiniDb } from '../data/minidb-client';
import type { DataContext } from '../data/middleware';

export interface AssetBucketRow {
  id: string;
  name: string;
  visibility: string;
  auth_method: string | null;
  workspace_id: string | null;
  owner_id: string | null;
}

const BUCKET_COLUMNS = 'a.id, a.name, a.visibility, a.auth_method, a.workspace_id, a.owner_id';

/** Find the asset bucket for a scope, creating it on first use. */
export async function getOrCreateAssetBucket(
  env: Env,
  ownerId: string,
  workspaceId: string | null,
): Promise<AssetBucketRow> {
  const existing = workspaceId
    ? await env.DB.prepare(
        `SELECT ${BUCKET_COLUMNS} FROM asset_buckets b JOIN artifacts a ON a.id = b.artifact_id WHERE a.deleted_at IS NULL AND b.workspace_id = ? LIMIT 1`,
      ).bind(workspaceId).first<AssetBucketRow>()
    : await env.DB.prepare(
        `SELECT ${BUCKET_COLUMNS} FROM asset_buckets b JOIN artifacts a ON a.id = b.artifact_id WHERE a.deleted_at IS NULL AND b.workspace_id IS NULL AND b.owner_id = ? LIMIT 1`,
      ).bind(ownerId).first<AssetBucketRow>();
  if (existing) return existing;

  const id = generateId('art');
  const slug = `assets-${id.slice(-12)}`;
  const name = workspaceId ? 'Workspace Assets' : 'My Assets';
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO artifacts (id, name, slug, display_slug, visibility, auth_method, password_hash, owner_id, workspace_id, folder_id, artifact_type, type_metadata, access_policy, is_example) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      id, name, slug, slug, 'public', null, null, ownerId, workspaceId, null,
      'json', '{}', null, 0,
    ),
    env.DB.prepare(
      'INSERT INTO asset_buckets (artifact_id, workspace_id, owner_id) VALUES (?, ?, ?)',
    ).bind(id, workspaceId, ownerId),
  ]);

  return { id, name, visibility: 'public', auth_method: null, workspace_id: workspaceId, owner_id: ownerId };
}

/**
 * A trusted DataContext for the bucket: the route layer has already verified the
 * caller may write to this scope (owner of a personal bucket, member of a team),
 * so the context is owner-authorized and flagged `assetBucket` to lift the
 * per-file/storage/count caps (see blob limits).
 */
export function buildAssetBucketContext(env: Env, bucket: AssetBucketRow, origin: string | null): DataContext {
  const workspaceId = bucket.workspace_id ?? '';
  return {
    artifactId: bucket.id,
    workspaceId,
    artifact: {
      id: bucket.id,
      name: bucket.name,
      visibility: bucket.visibility,
      auth_method: bucket.auth_method,
      workspace_id: bucket.workspace_id,
      owner_id: bucket.owner_id,
    },
    db: createMiniDb(env, bucket.id, workspaceId),
    env,
    origin,
    isOwner: true,
    canWrite: true,
    canWriteCollab: true,
    assetBucket: true,
  };
}
