/**
 * /v1/workspaces/{id}/vendor-packages — the libraries this workspace vendors.
 *
 * The built-in allowlist is a default, not a ceiling: a workspace admin registers the
 * npm package its artifacts need and publish starts rewriting that package's CDN URLs
 * to /vendor/. Reading is open to any member (they need to know what they can use);
 * writing is admin/owner, because it decides what this instance will fetch and host.
 */
import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { getInternalWorkspaceRole } from '../../workspaces';
import { generateId } from '../../crypto-utils';
import { apiErrorResponse, simpleApiError } from '../../http/api-error';
import {
  VENDOR_PACKAGES,
  instanceExtraPackages,
  invalidatePackageCache,
  isValidPackageName,
  vendorAllowsAny,
  vendorLibsEnabled,
} from '../../vendor-cdn';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function requireMember(env: Env, workspaceId: string, user: AuthUser, write: boolean) {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role) return { error: simpleApiError('Forbidden', 'FORBIDDEN', 403) };
  if (write && role !== 'owner' && role !== 'admin') {
    return {
      error: apiErrorResponse({
        message: 'Only a workspace admin can change vendored libraries',
        code: 'FORBIDDEN',
        status: 403,
        hint: 'Ask an owner or admin of this workspace to add the package.',
      }),
    };
  }
  return { role };
}

export async function handleListVendorPackages(
  env: Env,
  user: AuthUser,
  workspaceId: string,
): Promise<Response> {
  const guard = await requireMember(env, workspaceId, user, false);
  if (guard.error) return guard.error;

  const { results } = await env.DB.prepare(
    'SELECT package, added_by, created_at FROM vendor_packages WHERE workspace_id = ? ORDER BY package ASC',
  ).bind(workspaceId).all<{ package: string; added_by: string | null; created_at: string }>();

  return json({
    enabled: vendorLibsEnabled(env),
    // An allow-any instance has no list to compare against — say so rather than
    // implying the built-ins are the limit.
    allowsAny: vendorAllowsAny(env),
    builtIn: [...VENDOR_PACKAGES].sort(),
    instance: [...instanceExtraPackages(env)].sort(),
    workspace: (results ?? []).map(r => ({
      package: r.package,
      addedBy: r.added_by,
      createdAt: r.created_at,
    })),
  });
}

export async function handleAddVendorPackage(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
): Promise<Response> {
  const guard = await requireMember(env, workspaceId, user, true);
  if (guard.error) return guard.error;

  let body: { package?: unknown };
  try {
    body = await request.json();
  } catch {
    return simpleApiError('Invalid JSON body', 'INVALID_BODY', 400);
  }

  const pkg = typeof body.package === 'string' ? body.package.trim() : '';
  if (!isValidPackageName(pkg)) {
    return apiErrorResponse({
      message: 'Not an npm package name',
      code: 'INVALID_PACKAGE',
      status: 400,
      param: 'package',
      hint: 'Use the name as it appears on npm, e.g. "highcharts" or "@scope/name".',
    });
  }
  if (VENDOR_PACKAGES.has(pkg) || instanceExtraPackages(env).has(pkg)) {
    return json({ package: pkg, added: false, reason: 'already_available' });
  }

  await env.DB.prepare(
    `INSERT INTO vendor_packages (id, package, workspace_id, added_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, package) DO NOTHING`,
  ).bind(generateId('vpk'), pkg, workspaceId, user.id).run();
  await invalidatePackageCache(env, workspaceId);

  return json({ package: pkg, added: true }, 201);
}

export async function handleRemoveVendorPackage(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  pkg: string,
): Promise<Response> {
  const guard = await requireMember(env, workspaceId, user, true);
  if (guard.error) return guard.error;

  await env.DB.prepare('DELETE FROM vendor_packages WHERE workspace_id = ? AND package = ?')
    .bind(workspaceId, pkg).run();
  await invalidatePackageCache(env, workspaceId);

  // Already-published artifacts keep working: their rewritten URLs stay valid because
  // the bytes are already stored, and removal only stops future rewrites.
  return json({ package: pkg, removed: true });
}

/** Route block, mounted from the workspace API router. Null when nothing matches. */
export async function routeWorkspaceVendorPackages(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  const listMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/vendor-packages$/);
  if (listMatch) {
    const [, workspaceId] = listMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListVendorPackages(env, user, workspaceId));
    if (request.method === 'POST') return addCORS(await handleAddVendorPackage(request, env, user, workspaceId));
  }

  const oneMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/vendor-packages\/(.+)$/);
  if (oneMatch && request.method === 'DELETE') {
    const [, workspaceId, pkg] = oneMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRemoveVendorPackage(env, user, workspaceId, decodeURIComponent(pkg)));
  }

  return null;
}
