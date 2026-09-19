import type { Env } from './types';
import { getPlatformHostname } from './config/origins';
import { handleWorkspaceLanding } from './pages/workspace';
import { resolveRoutedDeployment, workspaceRouteKey, type RoutedDeployment } from './serve/deployment-cache';

export interface SubdomainContext {
  isSubdomain: boolean;
  workspaceSlug: string | null;
}

/**
 * Parse workspace subdomain against the configured platform apex.
 * `platformHost` = getPlatformHostname(env) (e.g. shareout.site or selfhost.example.com).
 */
export function parseSubdomain(hostname: string, platformHost: string): SubdomainContext {
  if (hostname === 'localhost' || hostname.includes('127.0.0.1')) {
    return { isSubdomain: false, workspaceSlug: null };
  }

  const apex = platformHost.replace(/^www\./, '');
  if (!apex || apex === 'localhost') {
    return { isSubdomain: false, workspaceSlug: null };
  }

  if (hostname === apex || hostname === `www.${apex}`) {
    return { isSubdomain: false, workspaceSlug: null };
  }

  const escaped = apex.replace(/\./g, '\\.');
  const match = hostname.match(
    new RegExp(`^([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])\\.${escaped}$`, 'i'),
  );
  if (match) {
    const subdomain = match[1]!.toLowerCase();
    // 'staging' = the staging deploy host. Treat as apex app, not a workspace subdomain.
    const reserved = ['www', 'api', 'app', 'admin', 'cdn', 'static', 'mail', 'assets', 'docs', 'staging'];
    if (reserved.includes(subdomain)) {
      return { isSubdomain: false, workspaceSlug: null };
    }
    return { isSubdomain: true, workspaceSlug: subdomain };
  }

  return { isSubdomain: false, workspaceSlug: null };
}

/** Convenience: parse using env.SHAREOUT_BASE_URL. */
export function parseSubdomainFromEnv(hostname: string, env: Env): SubdomainContext {
  return parseSubdomain(hostname, getPlatformHostname(env));
}

// Clean public URL for a workspace artifact on its subdomain:
// https://<workspace>.<apex>/<display_slug>/ — the human-facing share URL.
export function buildSubdomainUrl(baseUrl: string, workspaceSlug: string, displaySlug: string): string {
  const host = baseUrl.replace(/\/$/, '').replace(/^(https?:\/\/)/, `$1${workspaceSlug}.`);
  return `${host}/${displaySlug}/`;
}

export interface SubdomainRoute {
  // Terminal response (workspace landing / directory / not-found).
  response?: Response;
  // Re-dispatch the shared apex pipeline with this rewritten path.
  rewritePath?: string;
  // The production deployment behind a shorthand rewrite, resolved once.
  deployment?: RoutedDeployment;
  // Neither set => pass the request through to the shared pipeline unchanged.
}

// Routes that must behave exactly as on the apex so a workspace subdomain is a
// full mirror: auth/login, the user dashboard, the data API, the SDK, embeds,
// thumbnails, and apex-style artifact URLs (/a/<slug>/edit, /admin, ...).
const PASSTHROUGH_PREFIXES = [
  '/v1/',
  '/auth/',
  '/sdk/',
  '/embed/',
  '/t/',
  '/a/',
  '/p/',
  '/@',
  '/brand/',
  '/wl/',
  '/settings/',
  '/app/',
];
// `/home` (no trailing slash) is the user dashboard. `/home/` is the workspace's
// optional `home` artifact and is resolved through the shorthand branch below.
// `/create` is the AI build flow — it must behave as on the apex, not be treated
// as an artifact slug (which would 404 the sidebar's "Create with AI" button).
const PASSTHROUGH_EXACT = ['/home', '/create', '/create/'];

export async function resolveSubdomainRoute(
  request: Request,
  env: Env,
  workspaceSlug: string,
  path: string,
  executionCtx?: ExecutionContext
): Promise<SubdomainRoute> {
  if (
    PASSTHROUGH_PREFIXES.some((p) => path.startsWith(p)) ||
    PASSTHROUGH_EXACT.includes(path)
  ) {
    return {};
  }

  // The workspace root and /workspace are the same surface: members land in
  // their dashboard scoped to this workspace; everyone else sees the public
  // showcase (or the workspace's custom `home` artifact).
  if (path === '/workspace' || path === '/workspace/' || path === '/' || path === '') {
    return { response: await handleWorkspaceLanding(request, env, workspaceSlug) };
  }

  // Shorthand: /<artifact-slug>/<asset> -> apex /a/<deploy-slug>/<asset>, then the
  // shared pipeline serves/edits/admins it. One code path, no parity drift, no 404s.
  const parts = path.replace(/^\//, '').split('/');
  const artifactSlug = parts[0];
  const rest = parts.slice(1).join('/');

  // One cached lookup resolves the shorthand to the full deployment record; the
  // rewritten /a/ request reuses it instead of reading `deploy:` again.
  const deployment = await resolveRoutedDeployment(
    env,
    workspaceRouteKey(workspaceSlug, artifactSlug),
    'a.workspace_id = (SELECT id FROM workspaces WHERE slug = ?) AND a.display_slug = ?',
    [workspaceSlug, artifactSlug],
    executionCtx,
  );

  if (deployment) {
    return { rewritePath: `/a/${deployment.slug}${rest ? `/${rest}` : '/'}`, deployment };
  }

  // No direct artifact match: route through namespaced serve (handles folders and
  // yields the same not-found behaviour as before).
  return { rewritePath: `/@${workspaceSlug}/${artifactSlug}${rest ? `/${rest}` : ''}` };
}
