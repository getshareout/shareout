import type { Env } from '../types';
import { isFeatureEnabled, featureDisabledResponse } from '../features/flags';
import { isSuperAdminEmail } from '../superadmin/auth';

export const VISUAL_EDITOR_FEATURE = 'module.visual_editor';

/** Visual studio routes — excludes source editor (markdown/txt/json/csv). */
export function isVisualEditorRoute(editorSubPath: string): boolean {
  return !editorSubPath.startsWith('source');
}

export async function isVisualEditorEnabled(
  env: Env,
  workspaceId: string | null,
  userEmail?: string | null,
): Promise<boolean> {
  if (isSuperAdminEmail(userEmail, env)) return true;
  return isFeatureEnabled(env, VISUAL_EDITOR_FEATURE, workspaceId);
}

export async function requireVisualEditorEnabled(
  env: Env,
  workspaceId: string | null,
  userEmail?: string | null,
): Promise<Response | null> {
  if (await isVisualEditorEnabled(env, workspaceId, userEmail)) return null;
  return featureDisabledResponse(VISUAL_EDITOR_FEATURE);
}

/** Friendly HTML when someone opens /a/{slug}/edit in the browser with Live Studio off. */
export function visualEditorDisabledPage(baseUrl: string, slug: string): Response {
  const home = `${baseUrl.replace(/\/$/, '')}/a/${encodeURIComponent(slug)}/`;
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live Studio unavailable</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fafaf9;color:#1c1917}
.card{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#57534e;margin:0 0 1.25rem;line-height:1.5}
a{color:#2563eb;text-decoration:none;font-weight:500}a:hover{text-decoration:underline}</style></head>
<body><div class="card"><h1>Live Studio is not available</h1>
<p>The visual editor is turned off for this workspace. You can still view and share the published page.</p>
<p><a href="${home}">Back to the live page</a></p></div></body></html>`, {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
