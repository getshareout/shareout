// Absolute links the chat agent hands out. Bot replies leave the app, so every link is
// absolute on the platform apex (`/a/<slug>/` works for every artifact; one session cookie
// covers the apex and workspace subdomains), with `?page=` for a multi-page artifact's
// sub-page and `&section=` for a heading id the viewer scrolls the page to.
import type { Env } from '../types';
import { getPlatformOrigin } from '../config/origins';
import { isSafePagePath, isSafeSectionId } from '../serve/page-agent';

function encodePath(p: string): string {
  return encodeURIComponent(p).replace(/%2F/g, '/');
}

export function artifactLink(env: Env, slug: string, opts: { page?: string | null; entrypoint?: string | null; section?: string | null } = {}): string {
  const base = `${getPlatformOrigin(env)}/a/${encodeURIComponent(slug)}/`;
  const params: string[] = [];
  if (opts.page && opts.page !== opts.entrypoint && isSafePagePath(opts.page)) params.push(`page=${encodePath(opts.page)}`);
  if (opts.section && isSafeSectionId(opts.section)) params.push(`section=${encodeURIComponent(opts.section)}`);
  return params.length ? `${base}?${params.join('&')}` : base;
}

/** The HTML pages of an artifact's live version, entrypoint first ([] for a single page). */
export async function livePages(env: Env, artifactId: string): Promise<{ entrypoint: string; pages: string[] }> {
  const rows = (await env.DB.prepare(
    `SELECT v.entrypoint, s.path FROM deployments d
       JOIN versions v ON v.id = d.version_id
       JOIN assets s ON s.version_id = d.version_id AND s.mime = 'text/html'
      WHERE d.artifact_id = ? AND d.channel = 'production'
      ORDER BY s.path LIMIT 201`,
  ).bind(artifactId).all<{ entrypoint: string; path: string }>()).results || [];
  const entrypoint = rows[0]?.entrypoint ?? '';
  if (rows.length < 2) return { entrypoint, pages: [] };
  const paths = rows.map((r) => r.path).slice(0, 200);
  return { entrypoint, pages: paths.includes(entrypoint) ? [entrypoint, ...paths.filter((p) => p !== entrypoint)] : paths };
}
