import { getPlatformHostname, getPlatformOrigin } from '../config/origins';
import type { Env } from '../types';
import { escapeHtml } from '../html/utils';
import { renderHtmlPage } from '../design-system/shell';
import { workspacePageStyles } from '../design-system/pages/workspace.css';
import { workspaceIndexPageStyles } from '../design-system/pages/workspace-index.css';
import { getSessionUser } from '../auth';
import { getLinkedUserIds, placeholders } from '../account-links';
import { brandLockupHtml } from '../brand';
import { renderWorkspaceNotFoundPage } from './not-found';

export function renderWorkspaceIndexPage(env: Env): Response {
  const host = getPlatformHostname(env);
  const body = `<h1>Workspace apps</h1>
<p>Workspace directories live on each workspace subdomain:</p>
<p><code>https://<strong>your-slug</strong>.${escapeHtml(host)}/workspace/</code></p>
<p>On this domain use <code>/workspace/your-slug/</code> or <code>/workspace/?slug=your-slug</code>.</p>`;

  return renderHtmlPage({
    title: 'ShareOut Workspaces',
    pageStyles: workspaceIndexPageStyles,
    body,
  });
}

async function loadWorkspace(env: Env, workspaceSlug: string) {
  return env.DB.prepare(
    'SELECT id, name, description, branding FROM workspaces WHERE slug = ?'
  ).bind(workspaceSlug).first<{ id: string; name: string; description: string | null; branding: string | null }>();
}

async function isMember(env: Env, workspaceId: string, userId: string): Promise<boolean> {
  const ids = await getLinkedUserIds(env, userId);
  const row = await env.DB.prepare(
    `SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id IN (${placeholders(ids.length)}) LIMIT 1`
  ).bind(workspaceId, ...ids).first();
  return !!row;
}

// Workspaces are never public. The subdomain root is gated behind membership and
// branches on the session cookie, so those responses must never be shared-cached
// (a cached anonymous copy replayed to a member would leak the wrong view).
//   member            -> full dashboard scoped to this workspace
//   signed-in, no access -> "workspace is private" page (no sign-in loop)
//   anonymous         -> sign in, returning to this subdomain
export async function handleWorkspaceLanding(request: Request, env: Env, workspaceSlug: string): Promise<Response> {
  const workspace = await loadWorkspace(env, workspaceSlug);
  if (!workspace) {
    return renderWorkspaceNotFoundPage(workspaceSlug);
  }

  const user = await getSessionUser(request, env);

  if (user && await isMember(env, workspace.id, user.id)) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/home?workspace=${encodeURIComponent(workspace.id)}`, 'Cache-Control': 'no-store' },
    });
  }

  if (!user) {
    // Sign in from the subdomain so the OAuth return lands back here and mints a
    // zone-wide (.shareout.site) cookie the subdomain can read.
    return new Response(null, {
      status: 302,
      headers: { Location: '/auth/login?redirect=/', 'Cache-Control': 'no-store' },
    });
  }

  return renderNoAccessPage(workspace, getPlatformOrigin(env));
}

// The brand lockup used to link to shareout.site unconditionally, so someone denied
// access to a private workspace on a self-hosted instance was handed a link to a
// different product.
function renderNoAccessPage(workspace: { name: string }, origin: string): Response {
  const body = `<div class="ws">
<header class="ws-topbar">
  ${brandLockupHtml({ markSize: 24, href: origin })}
  <a class="ws-signin" href="/auth/logout?redirect=/">Switch account</a>
</header>
<main class="ws-main">
  <section class="ws-empty">
    <svg class="ws-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <p class="ws-empty-title">${escapeHtml(workspace.name)} is private</p>
    <p class="ws-empty-text">Your account isn't a member of this workspace. Switch to an account that has access.</p>
  </section>
</main>
</div>`;
  return renderHtmlPage({
    title: `${escapeHtml(workspace.name)} — ShareOut`,
    pageStyles: workspacePageStyles,
    body,
    lang: 'en',
    cacheControl: 'private, no-store',
  });
}

