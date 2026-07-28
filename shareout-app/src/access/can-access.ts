// External-sharing spine (work/030) — the unified access chokepoint.
//
// canAccess() is the ONE function every access seam consults to decide whether an
// identity may act on a resource. It is an ADDITIVE allow-path: callers keep their
// existing owner / collaborator / visibility checks and call canAccess only as a
// final OR. Because it is OR-ed in, returning `false` is always safe — it never
// revokes access another check already granted, and (critically) it never blanket-
// grants a private artifact to a workspace member (see the internal short-circuit).
//
// Resolution order (explicit short-circuit):
//   1. Internal-member path  — workspace-internal resources only (folder/dataset/...).
//   2. Ad-hoc collaborator   — artifact email share (the existing free path).
//   3. Paid grant path       — sharee-org + external_user grants, direct or inherited
//                              down a folder's ANCESTOR chain.
//   4. Deny.
//
// Read-time canAccess does NOT consult hasExternalSharingEntitlement: a lapsed card
// must not dark-screen a client's live deliverable (read grace). Only grant CREATION
// is gated. See src/access/entitlement.ts.

import type { Env, WorkspaceRole } from '../types';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { placeholders } from '../account-links';

export type Capability = 'view' | 'comment' | 'create' | 'edit' | 'manage' | 'api';
export type ResourceType =
  | 'folder' | 'artifact' | 'file' | 'dataset' | 'connection' | 'asset_bucket' | 'subdomain';

export interface AccessIdentity {
  userIds: string[];
  emails: string[];
}

// Capability lattice as implied-SETS, NOT an integer scale: a 'comment'-only grant
// (reviewer) must satisfy 'view' but NOT 'edit'. A linear `<` would wrongly let a
// reviewer edit once create/edit ship in Phase 2, so the shape is correct from day 1.
const IMPLIES: Record<Capability, Capability[]> = {
  view:    ['view'],
  comment: ['comment', 'view'],
  create:  ['create', 'view'],
  edit:    ['edit', 'create', 'comment', 'view'],
  manage:  ['manage', 'edit', 'create', 'comment', 'view'],
  api:     ['api'], // orthogonal (Phase 3) — implies nothing in the read lattice
};

/** True if holding `granted` is enough to perform `requested`. */
export function capabilitySatisfies(granted: Capability, requested: Capability): boolean {
  return IMPLIES[granted]?.includes(requested) ?? false;
}

// Workspace-internal resources where plain membership legitimately implies access
// (members manage their workspace's folders/datasets/connections). Artifacts are
// EXCLUDED on purpose: their access is visibility-dependent (a 'private' artifact is
// owner-only even inside a workspace), so blanket membership here would leak it.
const MEMBERSHIP_RESOURCES = new Set<ResourceType>([
  'folder', 'dataset', 'connection', 'asset_bucket',
]);

function roleSatisfies(role: WorkspaceRole, requested: Capability): boolean {
  if (requested === 'api') return false;          // a role never confers API scope
  if (requested === 'manage') return role === 'owner' || role === 'admin';
  return true;                                     // view/comment/create/edit
}

// --- Grant context (cached) -------------------------------------------------

interface GrantContext {
  shareeIds: string[];
  direct: Record<string, Capability[]>;  // `${resource_type}:${resource_id}` -> caps
  folders: Record<string, Capability[]>; // folder_id -> caps
}

const GRANTS_TTL = 60; // tighter than role cache (300s) — revocation sensitivity.

function identityKey(identity: AccessIdentity): string {
  return [...identity.userIds].sort().join(',');
}

// Per-workspace generation token. invalidateGrants bumps it, which orphans every
// cached key for that workspace (KV has no prefix-delete); orphans expire via TTL.
// This is how a sharee-wide grant change busts ALL its members' caches at once.
async function grantsGeneration(env: Env, workspaceId: string): Promise<string> {
  if (!env.SLUGS) return '0';
  try {
    return (await env.SLUGS.get(`grants-gen:${workspaceId}`)) ?? '0';
  } catch { return '0'; }
}

/** Bust grant caches for a workspace (optionally a specific user — we bump the whole
 *  workspace generation either way; over-invalidation is cheap with a 60s TTL). */
export async function invalidateGrants(
  env: Env,
  workspaceId: string,
  _userId?: string,
): Promise<void> {
  if (!env.SLUGS) return;
  try {
    await env.SLUGS.put(`grants-gen:${workspaceId}`, String(Date.now()));
  } catch { /* best-effort — stale entries still expire within TTL */ }
}

async function loadGrantContext(
  env: Env,
  workspaceId: string,
  identity: AccessIdentity,
): Promise<GrantContext> {
  const gen = await grantsGeneration(env, workspaceId);
  const cacheKey = `grants:${workspaceId}:${gen}:${identityKey(identity)}`;

  if (env.SLUGS) {
    try {
      const cached = await env.SLUGS.get(cacheKey);
      if (cached) return JSON.parse(cached) as GrantContext;
    } catch { /* fail-open to D1 */ }
  }

  const ctx = await buildGrantContext(env, workspaceId, identity);

  if (env.SLUGS) {
    try {
      await env.SLUGS.put(cacheKey, JSON.stringify(ctx), { expirationTtl: GRANTS_TTL });
    } catch { /* best-effort */ }
  }
  return ctx;
}

async function buildGrantContext(
  env: Env,
  workspaceId: string,
  identity: AccessIdentity,
): Promise<GrantContext> {
  const { userIds, emails } = identity;

  // 1. Which sharee orgs is this human a member of (by claimed user_id OR invite email)?
  let shareeIds: string[] = [];
  if (userIds.length || emails.length) {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT sm.sharee_id AS id
         FROM sharee_members sm
         JOIN sharees s ON s.id = sm.sharee_id
        WHERE s.workspace_id = ?
          AND sm.status != 'removed'
          AND ( sm.user_id IN (${placeholders(userIds.length)})
             OR sm.email   IN (${placeholders(emails.length)}) )`
    ).bind(workspaceId, ...userIds, ...emails).all<{ id: string }>();
    shareeIds = (results || []).map(r => r.id);
  }

  // 2. Grants whose subject is one of those sharee orgs OR this individual external user.
  const subjectIds = [...shareeIds, ...userIds];
  const direct: Record<string, Capability[]> = {};
  const folders: Record<string, Capability[]> = {};
  if (subjectIds.length) {
    const { results } = await env.DB.prepare(
      `SELECT resource_type, resource_id, capability
         FROM grants
        WHERE workspace_id = ?
          AND ( (subject_type = 'sharee'        AND subject_id IN (${placeholders(shareeIds.length)}))
             OR (subject_type = 'external_user' AND subject_id IN (${placeholders(userIds.length)})) )
          AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).bind(workspaceId, ...shareeIds, ...userIds)
      .all<{ resource_type: ResourceType; resource_id: string; capability: Capability }>();

    for (const g of results || []) {
      const bucket = g.resource_type === 'folder' ? folders : direct;
      const key = g.resource_type === 'folder' ? g.resource_id : `${g.resource_type}:${g.resource_id}`;
      (bucket[key] ||= []).push(g.capability);
    }
  }
  return { shareeIds, direct, folders };
}

// --- Folder ancestor chain (the only recursive CTE in the repo) --------------
//
// Walks UP from `folderId` to the workspace root, returning the resource's own
// ancestor ids. It NEVER expands a granted folder downward — we intersect this
// shallow upward chain against the user's already-cached granted-folder-id set, so
// inheritance is "a grant on any ancestor covers this resource". Depth = folder
// nesting (a handful), and it only runs on the grant-path slow lane.
async function ancestorFolderIds(env: Env, folderId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `WITH RECURSIVE chain(id) AS (
        SELECT ?
        UNION
        SELECT f.parent_id FROM folders f JOIN chain c ON f.id = c.id
         WHERE f.parent_id IS NOT NULL
      )
      SELECT id FROM chain`
  ).bind(folderId).all<{ id: string }>();
  return (results || []).map(r => r.id);
}

/** Resolve the folder a resource lives in (its grant inheritance seed), or null. */
async function resourceFolderId(
  env: Env,
  resourceType: ResourceType,
  resourceId: string,
): Promise<string | null> {
  if (resourceType === 'folder') return resourceId;
  if (resourceType === 'artifact') {
    const row = await env.DB.prepare('SELECT folder_id FROM artifacts WHERE id = ?')
      .bind(resourceId).first<{ folder_id: string | null }>();
    return row?.folder_id ?? null;
  }
  if (resourceType === 'file') {
    const row = await env.DB.prepare('SELECT folder_id, visibility FROM asset_deliverables WHERE id = ?')
      .bind(resourceId).first<{ folder_id: string | null; visibility: string }>();
    // A private file is NOT reachable via a folder grant — it needs a direct 'file' grant.
    // Keeps canAccess in agreement with the portal enumeration (listGrantedFiles excludes
    // private files from a granted folder's subtree).
    if (!row || row.visibility === 'private') return null;
    return row.folder_id ?? null;
  }
  // dataset/connection/asset_bucket/subdomain: no folder coupling in Phase 1.
  return null;
}

// --- The chokepoint ---------------------------------------------------------

async function resolveResourceWorkspaceId(
  env: Env,
  resourceType: ResourceType,
  resourceId: string,
): Promise<string | null> {
  switch (resourceType) {
    case 'folder':
      return (await env.DB.prepare('SELECT workspace_id FROM folders WHERE id = ?')
        .bind(resourceId).first<{ workspace_id: string | null }>())?.workspace_id ?? null;
    case 'artifact':
      return (await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
        .bind(resourceId).first<{ workspace_id: string | null }>())?.workspace_id ?? null;
    case 'asset_bucket':
      return (await env.DB.prepare('SELECT workspace_id FROM asset_buckets WHERE id = ?')
        .bind(resourceId).first<{ workspace_id: string | null }>())?.workspace_id ?? null;
    case 'file':
      return (await env.DB.prepare('SELECT workspace_id FROM asset_deliverables WHERE id = ?')
        .bind(resourceId).first<{ workspace_id: string | null }>())?.workspace_id ?? null;
    default:
      return null; // dataset/connection/subdomain resolved by their grant rows only
  }
}

function anySatisfies(caps: Capability[] | undefined, requested: Capability): boolean {
  return !!caps && caps.some(c => capabilitySatisfies(c, requested));
}

export async function canAccess(
  env: Env,
  identity: AccessIdentity,
  resourceType: ResourceType,
  resourceId: string,
  capability: Capability,
): Promise<boolean> {
  const workspaceId = await resolveResourceWorkspaceId(env, resourceType, resourceId);

  // 1. Internal-member path — workspace-internal resources only (never artifacts).
  if (workspaceId && MEMBERSHIP_RESOURCES.has(resourceType)) {
    const roles = await Promise.all(
      identity.userIds.map((uid) => getInternalWorkspaceRole(env, workspaceId, uid)),
    );
    if (roles.some((role) => role && roleSatisfies(role, capability))) return true;
  }

  // 2. Ad-hoc collaborator path (artifact email share — the existing free path).
  if (resourceType === 'artifact' && identity.emails.length &&
      capabilitySatisfies('comment', capability) /* view|comment only */) {
    const collab = await env.DB.prepare(
      `SELECT 1 FROM collaborators WHERE artifact_id = ? AND email IN (${placeholders(identity.emails.length)})`
    ).bind(resourceId, ...identity.emails).first();
    if (collab) return true;
  }

  // 3. Paid grant path — needs a resolvable owning workspace to scope the cache.
  if (!workspaceId) return false;
  const ctx = await loadGrantContext(env, workspaceId, identity);

  // 3a. Direct grant on the resource itself.
  if (anySatisfies(ctx.direct[`${resourceType}:${resourceId}`], capability)) return true;

  // 3b. Inherited grant on any ANCESTOR folder.
  if (Object.keys(ctx.folders).length) {
    const seed = await resourceFolderId(env, resourceType, resourceId);
    if (seed) {
      const chain = await ancestorFolderIds(env, seed);
      for (const fid of chain) {
        if (anySatisfies(ctx.folders[fid], capability)) return true;
      }
    }
  }

  return false; // 4. Deny.
}
