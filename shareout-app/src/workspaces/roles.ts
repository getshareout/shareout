import type { Env, WorkspaceRole } from '../types';
import { publicShowcaseSlugs, isShowcaseSlug } from '../visibility-config';
import { json } from './json-response';

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = { owner: 3, admin: 2, member: 1 };

// Membership (workspaceId,userId)→role is stable — it only changes on
// invite/role-change/remove/transfer/auto-join, each of which invalidates the key
// below. So cache it in SLUGS (the same KV used by art:/deploy:/cdnslug:/wsslug:),
// including negatives ('none') because the access path tests non-members a lot.
const WSROLE_TTL = 300;
const WSROLE_NONE = 'none';

function wsRoleCacheKey(workspaceId: string, userId: string): string {
  return `wsrole:${workspaceId}:${userId}`;
}

// Same key shape, separate namespace: the internal-only role differs from the raw
// role ONLY for external members (member_class='external'), so it needs its own
// cache entry. invalidateWorkspaceRole busts both so a member_class flip is honored.
function wsInternalRoleCacheKey(workspaceId: string, userId: string): string {
  return `wsintrole:${workspaceId}:${userId}`;
}

export async function invalidateWorkspaceRole(
  env: Env,
  workspaceId: string,
  userId: string
): Promise<void> {
  if (!env.SLUGS) return;
  try { await env.SLUGS.delete(wsRoleCacheKey(workspaceId, userId)); } catch { /* best-effort */ }
  try { await env.SLUGS.delete(wsInternalRoleCacheKey(workspaceId, userId)); } catch { /* best-effort */ }
}

export async function getWorkspaceRole(
  env: Env,
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole | null> {
  const cacheKey = wsRoleCacheKey(workspaceId, userId);

  if (env.SLUGS) {
    try {
      const cached = await env.SLUGS.get(cacheKey);
      if (cached) return cached === WSROLE_NONE ? null : (cached as WorkspaceRole);
    } catch { /* fail-open to D1 */ }
  }

  const member = await env.DB.prepare(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, userId).first<{ role: WorkspaceRole }>();
  const role = member?.role ?? null;

  if (env.SLUGS) {
    try { await env.SLUGS.put(cacheKey, role ?? WSROLE_NONE, { expirationTtl: WSROLE_TTL }); } catch { /* best-effort */ }
  }
  return role;
}

// The DEFAULT for every ACCESS decision (external-sharing spine, work/030). Identical
// to getWorkspaceRole but ignores external members: an external's workspace_members
// row (member_class='external') must NEVER satisfy a workspace-visibility check or
// promote to editor. getWorkspaceRole stays as-is for member-management LISTINGS.
export async function getInternalWorkspaceRole(
  env: Env,
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole | null> {
  const cacheKey = wsInternalRoleCacheKey(workspaceId, userId);

  if (env.SLUGS) {
    try {
      const cached = await env.SLUGS.get(cacheKey);
      if (cached) return cached === WSROLE_NONE ? null : (cached as WorkspaceRole);
    } catch { /* fail-open to D1 */ }
  }

  const member = await env.DB.prepare(
    "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND member_class = 'internal'"
  ).bind(workspaceId, userId).first<{ role: WorkspaceRole }>();
  const role = member?.role ?? null;

  if (env.SLUGS) {
    try { await env.SLUGS.put(cacheKey, role ?? WSROLE_NONE, { expirationTtl: WSROLE_TTL }); } catch { /* best-effort */ }
  }
  return role;
}

// A public showcase workspace is the deliberate exception to the
// OPEN_VISIBILITY_DISABLED launch gate: its artifacts may be 'public'
// and its subdomain root is browsable without sign-in. Membership is config-driven
// via the PUBLIC_SHOWCASE_WORKSPACES slug list — add a slug there to add another.
export async function isPublicShowcaseWorkspace(
  env: Env,
  workspaceId: string | null
): Promise<boolean> {
  if (!workspaceId || publicShowcaseSlugs(env).size === 0) return false;
  const row = await env.DB.prepare(
    'SELECT slug FROM workspaces WHERE id = ?'
  ).bind(workspaceId).first<{ slug: string }>();
  return isShowcaseSlug(env, row?.slug);
}

export async function requireWorkspaceRole(
  env: Env,
  workspaceId: string,
  userId: string,
  minRole: WorkspaceRole
): Promise<Response | null> {
  // Internal-only (external-sharing spine, work/030): an external member's edge must
  // never satisfy a management gate. Externals act only through explicit grants.
  const role = await getInternalWorkspaceRole(env, workspaceId, userId);
  // Not a member: stay deliberately vague (don't confirm the workspace exists).
  if (!role) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  // Member but under-privileged: safe to name the role they need.
  if (ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minRole]) {
    return json({ error: `Requires workspace ${minRole} role.`, code: 'INSUFFICIENT_ROLE' }, 403);
  }
  return null;
}
