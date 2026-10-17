/**
 * Absolute links to a workspace: its primary custom domain when it has an active one,
 * else `<slug>.<apex>`. Emails, publish results and share links all go through here so
 * a workspace with a custom domain never hands out the platform hostname.
 *
 * The primary hostname per slug is cached in KV (one key per workspace, so negatives
 * are bounded too) and dropped by every write that can change it.
 */
import type { Env } from '../../types';
import { deferWork, kvCacheGet } from '../../kv-cache';
import { requestMemo } from '../../http/request-scope';
import { customDomainsEnabled } from './hostname';

const TTL = 300;
const NONE = '-';

function key(slug: string): string {
  return `wsprimary:${slug.toLowerCase()}`;
}

async function loadPrimaryHost(env: Env, slug: string): Promise<string | null> {
  const kv = env.SLUGS;
  if (kv) {
    try {
      const cached = await kvCacheGet(kv, key(slug));
      if (cached) return cached === NONE ? null : cached;
    } catch { /* fall through */ }
  }
  let host: string | null = null;
  try {
    const row = await env.DB.prepare(
      `SELECT d.hostname AS hostname FROM workspace_domains d JOIN workspaces w ON w.id = d.workspace_id
        WHERE w.slug = ? AND d.is_primary = 1 AND d.status = 'active'`,
    ).bind(slug).first<{ hostname: string }>();
    host = row?.hostname ?? null;
  } catch {
    return null;
  }
  if (kv) deferWork(() => kv.put(key(slug), host ?? NONE, { expirationTtl: TTL }));
  return host;
}

/** The workspace's active primary custom hostname, or null. */
export function workspacePrimaryHost(env: Env, slug: string | null | undefined): Promise<string | null> {
  if (!slug || !customDomainsEnabled(env)) return Promise.resolve(null);
  return requestMemo(env, `wsprimary:${slug}`, () => loadPrimaryHost(env, slug));
}

/** `https://<primary custom domain>` or `https://<slug>.<apex>` (scheme from baseUrl). */
export async function workspaceOrigin(env: Env, baseUrl: string, slug: string): Promise<string> {
  const host = await workspacePrimaryHost(env, slug);
  if (host) return `https://${host}`;
  return baseUrl.replace(/\/$/, '').replace(/^(https?:\/\/)/, `$1${slug}.`);
}

/** Clean share URL for a workspace artifact: `<workspace origin>/<path>/`. */
export async function workspaceArtifactUrl(env: Env, baseUrl: string, slug: string, path: string): Promise<string> {
  return `${await workspaceOrigin(env, baseUrl, slug)}/${path}/`;
}

export async function invalidateWorkspacePrimaryHost(env: Env, ...slugs: Array<string | null | undefined>): Promise<void> {
  const kv = env.SLUGS;
  if (!kv) return;
  await Promise.all(slugs.filter((s): s is string => !!s).map((s) => kv.delete(key(s)).catch(() => {})));
}
