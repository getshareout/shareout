// External-sharing spine (work/030) — Phase 4. "Shared with me" portal enumeration.
// canAccess walks UP (does THIS resource sit under a grant?). The portal needs the
// inverse: enumerate every artifact an external identity may see. So we expand granted
// folders DOWN to their whole subtree (the only downward CTE in the repo) and union
// directly-granted artifacts.
import type { Env } from '../types';
import type { AccessIdentity } from '../access/can-access';
import { placeholders } from '../account-links';

export interface GrantedArtifact {
  id: string;
  name: string;
  slug: string;
  display_slug: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
}

export interface GrantedFile {
  id: string;
  name: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentPath: string;
  bucketId: string;
  workspace_id: string | null;
  workspace_name: string | null;
}

export interface PortalBranding {
  shareeName: string | null;
  logo: string | null;
  color: string | null;
}

async function grantSubjects(
  env: Env, identity: AccessIdentity,
): Promise<{ shareeIds: string[]; userIds: string[] }> {
  const { userIds, emails } = identity;
  let shareeIds: string[] = [];
  if (userIds.length || emails.length) {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT sm.sharee_id AS id
         FROM sharee_members sm
        WHERE sm.status != 'removed'
          AND ( sm.user_id IN (${placeholders(userIds.length)})
             OR sm.email   IN (${placeholders(emails.length)}) )`
    ).bind(...userIds, ...emails).all<{ id: string }>();
    shareeIds = (results || []).map(r => r.id);
  }
  return { shareeIds, userIds };
}

export async function listGrantedArtifacts(
  env: Env, identity: AccessIdentity,
): Promise<GrantedArtifact[]> {
  const { shareeIds, userIds } = await grantSubjects(env, identity);
  if (!shareeIds.length && !userIds.length) return [];

  const { results: grants } = await env.DB.prepare(
    `SELECT resource_type, resource_id FROM grants
      WHERE ( (subject_type = 'sharee'        AND subject_id IN (${placeholders(shareeIds.length)}))
           OR (subject_type = 'external_user' AND subject_id IN (${placeholders(userIds.length)})) )
        AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(...shareeIds, ...userIds)
    .all<{ resource_type: string; resource_id: string }>();

  const folderIds = (grants || []).filter(g => g.resource_type === 'folder').map(g => g.resource_id);
  const artifactIds = (grants || []).filter(g => g.resource_type === 'artifact').map(g => g.resource_id);
  if (!folderIds.length && !artifactIds.length) return [];

  // Expand granted folders to their whole subtree, then union direct artifact grants.
  const { results } = await env.DB.prepare(
    `WITH RECURSIVE sub(id) AS (
        SELECT id FROM folders WHERE id IN (${placeholders(folderIds.length)})
        UNION
        SELECT f.id FROM folders f JOIN sub s ON f.parent_id = s.id
      )
      SELECT a.id, a.name, a.slug, a.display_slug, a.workspace_id, w.name AS workspace_name
        FROM artifacts a
        LEFT JOIN workspaces w ON w.id = a.workspace_id
       WHERE a.deleted_at IS NULL
         AND ( a.id IN (${placeholders(artifactIds.length)})
            OR a.folder_id IN (SELECT id FROM sub) )
       ORDER BY a.name`
  ).bind(...folderIds, ...artifactIds).all<GrantedArtifact>();
  return results || [];
}

// Files shared with an external identity — the file sibling of listGrantedArtifacts.
// Same granted-folder subtree, plus direct 'file' grants. Leak guard: a folder grant
// surfaces only NON-private files in its subtree; a direct file grant surfaces the file
// regardless (an explicit share wins). Kept separate from the artifact enumeration so
// the artifact path is untouched — the extra grants read is one small query per portal load.
export async function listGrantedFiles(
  env: Env, identity: AccessIdentity,
): Promise<GrantedFile[]> {
  const { shareeIds, userIds } = await grantSubjects(env, identity);
  if (!shareeIds.length && !userIds.length) return [];

  const { results: grants } = await env.DB.prepare(
    `SELECT resource_type, resource_id FROM grants
      WHERE ( (subject_type = 'sharee'        AND subject_id IN (${placeholders(shareeIds.length)}))
           OR (subject_type = 'external_user' AND subject_id IN (${placeholders(userIds.length)})) )
        AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(...shareeIds, ...userIds)
    .all<{ resource_type: string; resource_id: string }>();

  const folderIds = (grants || []).filter(g => g.resource_type === 'folder').map(g => g.resource_id);
  const fileIds = (grants || []).filter(g => g.resource_type === 'file').map(g => g.resource_id);
  if (!folderIds.length && !fileIds.length) return [];

  const { results } = await env.DB.prepare(
    `WITH RECURSIVE sub(id) AS (
        SELECT id FROM folders WHERE id IN (${placeholders(folderIds.length)})
        UNION
        SELECT f.id FROM folders f JOIN sub s ON f.parent_id = s.id
      )
      SELECT d.id, d.name, d.bucket_artifact_id, d.workspace_id, w.name AS workspace_name,
             b.id AS blob_id, b.filename, b.mime_type, b.size_bytes
        FROM asset_deliverables d
        JOIN blobs b ON b.deliverable_id = d.id
          AND b.version_no = (SELECT MAX(version_no) FROM blobs WHERE deliverable_id = d.id)
        LEFT JOIN workspaces w ON w.id = d.workspace_id
       WHERE d.deleted_at IS NULL
         AND ( d.id IN (${placeholders(fileIds.length)})
            OR (d.folder_id IN (SELECT id FROM sub) AND d.visibility != 'private') )
       ORDER BY d.name`
  ).bind(...folderIds, ...fileIds).all<{
    id: string; name: string; bucket_artifact_id: string; workspace_id: string | null;
    workspace_name: string | null; blob_id: string; filename: string; mime_type: string; size_bytes: number;
  }>();
  return (results || []).map((r) => ({
    id: r.id, name: r.name, filename: r.filename, mimeType: r.mime_type, sizeBytes: r.size_bytes,
    // Identity-checked file route (work/042 P3): a directly-granted PRIVATE file serves
    // only here (the raw blob route now 403s private files); the sharee's session is
    // verified against the grant. Non-private granted files serve here too.
    contentPath: `/v1/files/${r.id}/content`,
    bucketId: r.bucket_artifact_id,
    workspace_id: r.workspace_id, workspace_name: r.workspace_name,
  }));
}

// Branding for the portal header: the first Sharee the identity belongs to that has
// branding set. Null logo/color → the portal falls back to the neutral default.
export async function resolvePortalBranding(
  env: Env, identity: AccessIdentity,
): Promise<PortalBranding | null> {
  const { shareeIds } = await grantSubjects(env, identity);
  if (!shareeIds.length) return null;
  const row = await env.DB.prepare(
    `SELECT name, branding FROM sharees
      WHERE id IN (${placeholders(shareeIds.length)}) ORDER BY created_at LIMIT 1`
  ).bind(...shareeIds).first<{ name: string; branding: string | null }>();
  if (!row) return null;
  let branding: { logo?: string; color?: string } = {};
  if (row.branding) { try { branding = JSON.parse(row.branding); } catch { /* ignore */ } }
  return { shareeName: row.name, logo: branding.logo ?? null, color: branding.color ?? null };
}
