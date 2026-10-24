import { slugify } from '../slugify';
/** Slug validation and generation for workspace URLs. */
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export function generateWorkspaceSlug(name: string): string {
  return slugify(name, 30) || 'workspace';
}

/**
 * Slugs a workspace may not take, because the slug is also its subdomain and these
 * hosts or paths already mean something on the instance.
 */
export const RESERVED_WORKSPACE_SLUGS: readonly string[] = [
  'www', 'api', 'app', 'admin', 'cdn', 'static', 'mail', 'assets', 'docs', 'staging',
  'support', 'help', 'status', 'auth', 'login', 'signup', 'home', 'settings', 'billing',
  'sdk', 'embed', 'mcp', 'oauth', 'vendor', 'inbox', 'email', 'smtp', 'ftp', 'root',
  'system', 'internal', 'shareout',
];

export function isReservedWorkspaceSlug(slug: string): boolean {
  return RESERVED_WORKSPACE_SLUGS.includes(slug.toLowerCase());
}
