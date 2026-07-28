import type { Env, DataResponse } from '../types';
import { DATA_ERRORS } from '../types';
import {
  verifyAccessToken,
  verifySessionToken,
  extractTokenFromCookie,
} from '../token';
import { validateToken, type ServiceScope } from '../api-auth';
import { getInternalWorkspaceRole } from '../workspaces';
import { canAccess } from '../access/can-access';
import { normalizeVisibility } from '../visibility-config';
import { apiErrorResponse } from '../http/api-error';
import { createMiniDb, type MiniDb } from './minidb-client';
import { parseAccessPolicy, resolveViewerScope, type ViewerScope, type Viewer } from './access-policy';

export interface DataContext {
  artifactId: string;
  // Tenant partition key (ADR 28). Routes mini-store writes and is the enterprise
  // isolation seam. May be empty only for legacy artifacts with no workspace.
  workspaceId: string;
  artifact: {
    id: string;
    name: string;
    visibility: string;
    auth_method: string | null;
    workspace_id: string | null;
    owner_id: string | null;
    // Per-artifact anonymous-access opt-ins (migration 0080). 0 = deny (default).
    // Optional: only the HTTP data router (dataMiddleware) populates these.
    // Trusted internal callers (crew, account bot, headless edit) build a
    // DataContext directly and call store fns below the router gate, so they
    // omit these — their writes are owner/system-authorized by construction.
    allow_anon_write?: number;
    allow_anon_email?: number;
    allow_anon_agent?: number;
    allow_anon_collab?: number;
  };
  // Per-artifact mini-store (json/tables), backed by a Durable Object (ADR 28).
  db: MiniDb;
  env: Env;
  origin: string | null;
  // Resolved viewer identity (set for authenticated requests; anonymous otherwise).
  // Set by dataMiddleware (HTTP router path) only.
  viewer?: Viewer;
  // True when the requester is the artifact owner/editor (verified identity).
  // Used for row-level access-policy bypass — editors count as "owner" here.
  isOwner?: boolean;
  // True only for the artifact's actual owner_id (not editors/viewers).
  // Used by per-table write roles (sources.tables.<name>.write: "owner").
  isArtifactOwner?: boolean;
  // Write capability for the artifact's own private stores (json/tables/blobs/
  // datasets): owner, OR a public artifact whose owner opted into anon writes.
  // Anonymous viewers of a public artifact are read-only unless this is true.
  // Enforced by the router gate; undefined for trusted internal contexts.
  canWrite?: boolean;
  // Realtime/Y.js collab capability: owner, OR anon-collab explicitly opted in.
  canWriteCollab?: boolean;
  // Artifact Tests (Phase 2 Unit B): true when this request is part of a sandboxed
  // test run (the renderer carries an `owner_test` session token). Reads resolve as
  // the owner so the artifact loads, but the data router blocks ALL mutating methods
  // and email/provision swallow — nothing a test flow does can persist or send.
  testRun?: boolean;
  // Row-level access scope for the current viewer (0042). null/undefined = no
  // filtering (no policy / owner bypass / default-allow). values: [] = deny all rows.
  viewerScope?: ViewerScope | null;
  // Defer background work past the response (Workers ExecutionContext.waitUntil),
  // when available. Used to dispatch event-triggered crew runs without blocking.
  waitUntil?: (promise: Promise<unknown>) => void;
  // True when this context targets a workspace/personal asset bucket: lifts the
  // per-file/storage/count blob caps to library-scale (see blob limits).
  assetBucket?: boolean;
}

/**
 * Read-only-default write capability for a data request (Workstream A). Pure so
 * it can be enumerated in tests. Anonymous viewers of a PUBLIC artifact are
 * read-only unless the owner opted in per capability (migration 0080). Non-public
 * artifacts return true here — they only reach the data layer after checkDataAuth
 * authorized them, and per-viewer write scoping (row-level access policy) is the
 * handler's job, so the gate must not block authenticated workspace members.
 */
export function computeWriteCapability(
  visibility: string,
  isOwner: boolean,
  allowAnonWrite: number,
  allowAnonCollab: number
): { canWrite: boolean; canWriteCollab: boolean } {
  const isPublic = visibility === 'public';
  if (!isPublic) return { canWrite: true, canWriteCollab: true };
  return {
    canWrite: isOwner || allowAnonWrite === 1,
    canWriteCollab: isOwner || allowAnonCollab === 1,
  };
}

const ARTIFACT_CACHE_TTL = 300; // 5 minutes
// Cache key version. Bump when CachedArtifact's shape changes so stale entries
// (missing newly-added columns) are treated as misses. v2: added allow_anon_*.
const ARTIFACT_CACHE_PREFIX = 'artv2:';

interface CachedArtifact {
  id: string;
  name: string;
  visibility: string;
  auth_method: string | null;
  workspace_id: string | null;
  owner_id: string | null;
  access_policy: string | null;
  allow_anon_write: number;
  allow_anon_email: number;
  allow_anon_agent: number;
  allow_anon_collab: number;
}

const ARTIFACT_COLUMNS =
  'id, name, visibility, auth_method, workspace_id, owner_id, access_policy, ' +
  'allow_anon_write, allow_anon_email, allow_anon_agent, allow_anon_collab';

async function getCachedArtifact(env: Env, key: string): Promise<CachedArtifact | null> {
  if (!env.SLUGS) return null;
  try {
    return await env.SLUGS.get<CachedArtifact>(`${ARTIFACT_CACHE_PREFIX}${key}`, 'json');
  } catch {
    return null;
  }
}

async function cacheArtifact(env: Env, key: string, artifact: CachedArtifact): Promise<void> {
  if (!env.SLUGS) return;
  try {
    await env.SLUGS.put(`${ARTIFACT_CACHE_PREFIX}${key}`, JSON.stringify(artifact), { expirationTtl: ARTIFACT_CACHE_TTL });
  } catch {}
}

export async function dataMiddleware(
  request: Request,
  env: Env,
  artifactIdOrSlug: string
): Promise<DataContext | Response> {
  const origin = request.headers.get('Origin');
  setRequestOrigin(origin);

  // Try KV cache first
  let artifact = await getCachedArtifact(env, artifactIdOrSlug);

  if (!artifact) {
    artifact = await env.DB.prepare(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE id = ?`
    ).bind(artifactIdOrSlug).first<CachedArtifact>();

    if (!artifact) {
      artifact = await env.DB.prepare(`
        SELECT ${ARTIFACT_COLUMNS.split(', ').map(c => `a.${c}`).join(', ')}
        FROM deployments d
        JOIN artifacts a ON a.id = d.artifact_id
        WHERE d.slug = ? AND d.channel = 'production'
        LIMIT 1
      `).bind(artifactIdOrSlug).first<CachedArtifact>();
    }

    // Cache for next time
    if (artifact) {
      await cacheArtifact(env, artifactIdOrSlug, artifact);
    }
  }

  if (!artifact) {
    return errorResponse(DATA_ERRORS.ARTIFACT_NOT_FOUND, origin);
  }

  // Legacy 'unlisted' rows (pre-migration) read as 'public' so every downstream
  // check sees the single open visibility. 'unlisted' retired 2026-07.
  artifact.visibility = normalizeVisibility(artifact.visibility);

  // Default viewer: anonymous (public artifacts). The authenticated branch below
  // overrides this with the verified identity.
  let viewer: Viewer = { email: null, isOwner: false };

  // checkDataAuth runs for EVERY visibility (not just private/workspace): public
  // artifacts must still resolve the OWNER's identity so they can write to their
  // own artifact's data and so we can derive write capability. For a truly
  // anonymous public viewer (no Authorization header, no session cookie) it
  // returns `deny` after cheap header checks with zero DB queries.
  const requiresAuth = artifact.visibility === 'private' || artifact.visibility === 'workspace';
  const authResult = await checkDataAuth(request, env, artifact);
  if (requiresAuth && !authResult.authorized) {
    return errorResponse(
      authResult.needsAuth ? DATA_ERRORS.UNAUTHORIZED : DATA_ERRORS.FORBIDDEN,
      origin
    );
  }
  // Agent (service) tokens: a missing data:read scope denies the request outright.
  if (authResult.serviceScopes && !authResult.serviceScopes.includes('data:read')) {
    return errorResponse(DATA_ERRORS.FORBIDDEN, origin);
  }
  if (authResult.authorized) viewer = authResult.viewer;

  const workspaceId = artifact.workspace_id ?? '';
  const viewerScope = resolveViewerScope(parseAccessPolicy(artifact.access_policy), viewer);

  const isOwner = viewer.isOwner;
  const isArtifactOwner = authResult.authorized && authResult.isArtifactOwner === true;
  const testRun = authResult.authorized && authResult.testRun === true;
  let { canWrite, canWriteCollab } = computeWriteCapability(
    artifact.visibility,
    isOwner,
    artifact.allow_anon_write ?? 0,
    artifact.allow_anon_collab ?? 0
  );
  // A sandboxed test run reads as the owner but can never write: the router blocks
  // every mutation, and these flags belt-and-suspenders the anon-write/collab gates.
  if (testRun) {
    canWrite = false;
    canWriteCollab = false;
  }
  // Agent token without data:write reads but never mutates — reuses the router's
  // existing canWrite gate, same as a sandboxed test run.
  if (authResult.serviceScopes && !authResult.serviceScopes.includes('data:write')) {
    canWrite = false;
    canWriteCollab = false;
  }
  // External-sharing spine (work/030) Phase 3: an external identity (token or personal)
  // may only WRITE where it holds an 'edit' grant. A 'view'-only external is read-only.
  if (authResult.externalSubjectUserId && (canWrite || canWriteCollab)) {
    const identity = { userIds: [authResult.externalSubjectUserId], emails: viewer.email ? [viewer.email] : [] };
    if (!(await canAccess(env, identity, 'artifact', artifact.id, 'edit'))) {
      canWrite = false;
      canWriteCollab = false;
    }
  }

  return {
    artifactId: artifact.id,
    workspaceId,
    artifact,
    db: createMiniDb(env, artifact.id, workspaceId),
    env,
    origin,
    viewerScope,
    viewer,
    isOwner,
    isArtifactOwner,
    canWrite,
    canWriteCollab,
    testRun,
  };
}

// True when `userId` holds an EXTERNAL membership edge in the workspace (work/030).
async function isExternalMember(env: Env, workspaceId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND member_class = 'external'"
  ).bind(workspaceId, userId).first();
  return !!row;
}

type DataAuthResult = {
  authorized: boolean;
  needsAuth: boolean;
  viewer: Viewer;
  /** True only for the real artifact owner (not an editor collaborator). */
  isArtifactOwner?: boolean;
  testRun?: boolean;
  serviceScopes?: ServiceScope[];
  externalSubjectUserId?: string;
};

async function checkDataAuth(
  request: Request,
  env: Env,
  artifact: { id: string; auth_method: string | null; owner_id: string | null; visibility: string; workspace_id: string | null }
): Promise<DataAuthResult> {
  const deny: DataAuthResult = { authorized: false, needsAuth: true, viewer: { email: null, isOwner: false } };
  const authHeader = request.headers.get('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyAccessToken(token, artifact.id, env);
    // 'content' tokens authorize loading static artifact bytes on the content domain
    // ONLY (ADR 30) — they carry no viewer identity and must never grant data access.
    if (payload && payload.authType !== 'content') {
      // Artifact-scoped access token (password/credentials/owner/viewer-minted).
      // 'owner_test' is the owner identity used by a sandboxed test render: it reads
      // as the owner but flags the request so the router blocks every mutation.
      const isOwner = payload.authType === 'owner' || payload.authType === 'editor' || payload.authType === 'owner_test';
      const isArtifactOwner = payload.authType === 'owner' || payload.authType === 'owner_test';
      const testRun = payload.authType === 'owner_test';
      return {
        authorized: true,
        needsAuth: false,
        viewer: { email: payload.email ?? null, isOwner },
        isArtifactOwner,
        testRun,
      };
    }
    // Fall back to a ShareOut API token (so_...): proves ownership of own artifacts.
    const apiUser = await validateToken(request, env);
    if (apiUser) {
      // Service (Agent) tokens are confined to their own workspace — stricter than
      // personal tokens. Scopes ride along so dataMiddleware can gate read/write.
      if (apiUser.service) {
        if (!artifact.workspace_id || artifact.workspace_id !== apiUser.service.workspaceId) {
          return deny;
        }
        // External-sharing spine (work/030) Phase 3: an EXTERNAL token is NOT workspace-
        // blanket. Even inside its workspace it may only touch artifacts the named
        // external user was granted — resolve through canAccess, deny otherwise.
        const extUserId = apiUser.service.externalUserId;
        if (extUserId) {
          const identity = { userIds: [extUserId], emails: apiUser.email ? [apiUser.email] : [] };
          // Authenticated but not granted → forbidden, not "needs auth".
          if (!(await canAccess(env, identity, 'artifact', artifact.id, 'view')))
            return { authorized: false, needsAuth: false, viewer: { email: null, isOwner: false } };
          return {
            authorized: true,
            needsAuth: false,
            viewer: { email: apiUser.email, isOwner: false },
            isArtifactOwner: false,
            serviceScopes: apiUser.service.scopes,
            externalSubjectUserId: extUserId,
          };
        }
        const owns = apiUser.id === artifact.owner_id;
        return {
          authorized: true,
          needsAuth: false,
          viewer: { email: apiUser.email, isOwner: owns },
          isArtifactOwner: owns,
          serviceScopes: apiUser.service.scopes,
        };
      }
      // Personal so_ token. Close the external-member loophole: a known external member
      // must resolve through grants even with their own personal token (work/030 P3).
      if (apiUser.id !== artifact.owner_id && artifact.workspace_id &&
          await isExternalMember(env, artifact.workspace_id, apiUser.id)) {
        const identity = { userIds: [apiUser.id], emails: apiUser.email ? [apiUser.email] : [] };
        if (!(await canAccess(env, identity, 'artifact', artifact.id, 'view')))
          return { authorized: false, needsAuth: false, viewer: { email: null, isOwner: false } };
        return {
          authorized: true,
          needsAuth: false,
          viewer: { email: apiUser.email, isOwner: false },
          isArtifactOwner: false,
          externalSubjectUserId: apiUser.id,
        };
      }
      const owns = apiUser.id === artifact.owner_id;
      return {
        authorized: true,
        needsAuth: false,
        viewer: { email: apiUser.email, isOwner: owns },
        isArtifactOwner: owns,
      };
    }
    return deny;
  }

  const cookies = request.headers.get('Cookie');

  // The artifact owner can always read their own data from a browser session,
  // regardless of auth_method. checkDataAuth runs before the per-method gates,
  // so without this an owner viewing their own password-protected artifact is
  // rejected here before verifyOwner ever runs.
  if (artifact.owner_id) {
    const sessionToken = extractTokenFromCookie(cookies, /shareout_session=([^;]+)/);
    if (sessionToken) {
      const payload = await verifySessionToken(sessionToken, env);
      // The signed token already carries userId; compare it to the owner id
      // directly instead of re-reading the users row.
      if (payload && payload.userId === artifact.owner_id) {
        return {
          authorized: true,
          needsAuth: false,
          viewer: { email: payload.email, isOwner: true },
          isArtifactOwner: true,
        };
      }
    }
  }

  if (artifact.auth_method === 'password' || artifact.auth_method === 'credentials') {
    const token = extractTokenFromCookie(cookies, new RegExp(`shareout_access_${artifact.id}=([^;]+)`));
    if (token) {
      const payload = await verifyAccessToken(token, artifact.id, env);
      if (payload) {
        const owns = payload.authType === 'owner';
        return {
          authorized: true,
          needsAuth: false,
          viewer: { email: null, isOwner: owns },
          isArtifactOwner: owns,
        };
      }
      return deny;
    }
  }

  if (artifact.auth_method === 'google') {
    const token = extractTokenFromCookie(cookies, /shareout_session=([^;]+)/);
    if (token) {
      return verifyGoogleSession(token, artifact, env);
    }
  }

  return deny;
}

async function verifyGoogleSession(
  token: string,
  artifact: { id: string; owner_id: string | null; visibility: string; workspace_id: string | null },
  env: Env
): Promise<DataAuthResult> {
  const deny: DataAuthResult = { authorized: false, needsAuth: true, viewer: { email: null, isOwner: false } };
  const payload = await verifySessionToken(token, env);
  if (!payload) return deny;

  // Session user is the artifact owner_id — full owner, not just an editor collab row.
  if (artifact.owner_id && payload.userId === artifact.owner_id) {
    return {
      authorized: true,
      needsAuth: false,
      viewer: { email: payload.email, isOwner: true },
      isArtifactOwner: true,
    };
  }

  const collaborator = await env.DB.prepare(
    'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(artifact.id, payload.email).first<{ role: string }>();
  if (collaborator) {
    // Owner/editor bypass the row-level policy; viewers are filtered.
    const isOwner = collaborator.role === 'owner' || collaborator.role === 'editor';
    return {
      authorized: true,
      needsAuth: false,
      viewer: { email: payload.email, isOwner },
      isArtifactOwner: collaborator.role === 'owner',
    };
  }

  // Workspace-visible artifacts grant read access to any INTERNAL workspace member.
  // They are treated as filtered viewers (subject to the row-level access policy).
  // getInternalWorkspaceRole (not the raw getWorkspaceRole) so an external's
  // membership edge never satisfies this — externals must hold an explicit grant.
  if (artifact.visibility === 'workspace' && artifact.workspace_id) {
    if (await getInternalWorkspaceRole(env, artifact.workspace_id, payload.userId)) {
      return {
        authorized: true,
        needsAuth: false,
        viewer: { email: payload.email, isOwner: false },
        isArtifactOwner: false,
      };
    }
  }

  // External-sharing spine (work/030): an external user with a view grant on this
  // artifact (directly or via an ancestor folder) reads it as a filtered viewer,
  // regardless of visibility. Additive — only reached after the checks above fail.
  const emails = payload.email ? [payload.email] : [];
  if (await canAccess(env, { userIds: [payload.userId], emails }, 'artifact', artifact.id, 'view')) {
    return {
      authorized: true,
      needsAuth: false,
      viewer: { email: payload.email, isOwner: false },
      isArtifactOwner: false,
    };
  }

  return deny;
}

/** Resolve the authenticated requester to a user id (API token, artifact access
 * token carrying an email, or session cookie). Null when anonymous. */
export async function resolveRequesterUserId(request: Request, ctx: DataContext): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const apiUser = await validateToken(request, ctx.env);
    if (apiUser) return apiUser.id;
    const payload = await verifyAccessToken(authHeader.slice(7), ctx.artifactId, ctx.env);
    if (payload?.email) {
      const u = await ctx.env.DB.prepare('SELECT id FROM users WHERE email = ?')
        .bind(payload.email).first<{ id: string }>();
      if (u) return u.id;
    }
  }
  const cookies = request.headers.get('Cookie');
  const sessionToken = extractTokenFromCookie(cookies, /shareout_session=([^;]+)/);
  if (sessionToken) {
    const payload = await verifySessionToken(sessionToken, ctx.env);
    // Session token carries the user id; no users lookup needed.
    if (payload?.userId) return payload.userId;
  }
  return null;
}

/**
 * Workspace connectors are reusable by any member of the workspace unless the
 * owner reserved them (is_private). Returns true when `connectionId` is a
 * non-private workspace-scoped platform connection in the artifact's workspace
 * AND the requester is a member of that workspace. Artifact-scoped connections
 * always return false here (they stay owner-only via verifyOwner).
 */
export async function verifyWorkspaceConnectionAccess(
  request: Request,
  ctx: DataContext,
  connectionId: string
): Promise<boolean> {
  if (!ctx.workspaceId) return false;
  const conn = await ctx.env.DB.prepare(
    `SELECT is_private, credential_scope FROM connections
       WHERE scope_type = 'workspace' AND scope_id = ? AND id = ? AND kind = 'platform'`
  ).bind(ctx.workspaceId, connectionId).first<{ is_private: number | null; credential_scope: string | null }>();
  // Private connections stay owner-only; per_user connections route through the
  // per-user gate (each member uses their own credentials), never the shared blob.
  if (!conn || conn.is_private || conn.credential_scope === 'per_user') return false;
  const userId = await resolveRequesterUserId(request, ctx);
  if (!userId) return false;
  return (await getInternalWorkspaceRole(ctx.env, ctx.workspaceId, userId)) !== null;
}

/**
 * Workspace platform connectors with credential_scope = per_user: a workspace
 * member may query using their own stored credentials. Mirrors the generic
 * variant but resolves by connection id (the platform path has no name).
 */
export async function verifyPerUserPlatformConnectionQuery(
  request: Request,
  ctx: DataContext,
  connectionId: string
): Promise<'allowed' | 'credentials_required' | 'denied'> {
  if (!ctx.workspaceId) return 'denied';

  const conn = await ctx.env.DB.prepare(
    `SELECT id FROM connections
       WHERE scope_type = 'workspace' AND scope_id = ? AND id = ? AND kind = 'platform' AND credential_scope = 'per_user'`
  ).bind(ctx.workspaceId, connectionId).first<{ id: string }>();
  if (!conn) return 'denied';

  const userId = await resolveRequesterUserId(request, ctx);
  if (!userId) return 'denied';
  if ((await getInternalWorkspaceRole(ctx.env, ctx.workspaceId, userId)) === null) return 'denied';

  const hasCreds = await ctx.env.DB.prepare(
    'SELECT 1 FROM connection_user_credentials WHERE connection_id = ? AND user_id = ?'
  ).bind(conn.id, userId).first();

  return hasCreds ? 'allowed' : 'credentials_required';
}

/**
 * Workspace generic connectors with credential_scope = per_user: any workspace
 * member may query using their own stored credentials (not the artifact owner gate).
 */
export async function verifyPerUserWorkspaceConnectionQuery(
  request: Request,
  ctx: DataContext,
  connectionName: string
): Promise<'allowed' | 'credentials_required' | 'denied'> {
  if (!ctx.workspaceId) return 'denied';

  const conn = await ctx.env.DB.prepare(`
    SELECT id, credential_scope FROM connections
    WHERE scope_type = 'workspace' AND scope_id = ? AND name = ? AND kind = 'generic' AND credential_scope = 'per_user'
  `).bind(ctx.workspaceId, connectionName).first<{ id: string; credential_scope: string }>();

  if (!conn) return 'denied';

  const userId = await resolveRequesterUserId(request, ctx);
  if (!userId) return 'denied';
  if ((await getInternalWorkspaceRole(ctx.env, ctx.workspaceId, userId)) === null) return 'denied';

  const hasCreds = await ctx.env.DB.prepare(
    'SELECT 1 FROM connection_user_credentials WHERE connection_id = ? AND user_id = ?'
  ).bind(conn.id, userId).first();

  return hasCreds ? 'allowed' : 'credentials_required';
}

export function errorResponse(
  error: { code: string; message: string; status: number; hint?: string; suggestion?: string; param?: string; docs?: string },
  origin?: string | null
): Response {
  return apiErrorResponse(error, { headers: corsHeaders(origin) });
}

export function successResponse<T>(data: T, status = 200, origin?: string | null): Response {
  return Response.json(
    { success: true, data } as DataResponse<T>,
    { status, headers: corsHeaders(origin) }
  );
}

// Global origin storage for current request - used when origin isn't passed
let currentRequestOrigin: string | null = null;

export function setRequestOrigin(origin: string | null): void {
  currentRequestOrigin = origin;
}

export function corsHeaders(origin?: string | null): HeadersInit {
  // Use provided origin, fall back to global, then default
  const requestOrigin = origin ?? currentRequestOrigin;

  // For null origin (sandboxed iframes), return null as allowed origin
  // For other origins, reflect them back (data is scoped to artifact anyway)
  const allowedOrigin = requestOrigin === 'null' ? 'null' : requestOrigin;

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
  // No Origin means this is not a CORS request, so there is nothing to allow. This
  // used to fall back to a hardcoded shareout.site, which told every self-hosted
  // instance's clients that another company's origin was the permitted one.
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return headers;
}

export function handleCorsOptions(request: Request): Response {
  const origin = request.headers.get('Origin');
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function verifyOwner(
  request: Request,
  ctx: DataContext
): Promise<boolean> {
  const ownerId = ctx.artifact.owner_id;
  if (!ownerId) return false;

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyAccessToken(token, ctx.artifactId, ctx.env);
    if (payload && payload.authType === 'owner') {
      return true;
    }

    // A user's ShareOut API token proves ownership of their own artifacts.
    const apiUser = await validateToken(request, ctx.env);
    if (apiUser && apiUser.id === ownerId) {
      return true;
    }
  }

  const cookies = request.headers.get('Cookie');
  const sessionToken = extractTokenFromCookie(cookies, /shareout_session=([^;]+)/);
  if (sessionToken) {
    const payload = await verifySessionToken(sessionToken, ctx.env);
    if (payload) {
      const owner = await ctx.env.DB.prepare(
        'SELECT id FROM users WHERE id = ? AND email = ?'
      ).bind(ownerId, payload.email).first();
      return !!owner;
    }
  }

  return false;
}
