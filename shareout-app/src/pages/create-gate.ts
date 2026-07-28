import type { Env } from '../types';
import { isFeatureEnabled, featureDisabledResponse } from '../features/flags';

export const CREATE_FEATURE = 'ai.create';

export async function isCreateEnabled(
  env: Env,
  workspaceId: string | null,
): Promise<boolean> {
  return isFeatureEnabled(env, CREATE_FEATURE, workspaceId);
}

export async function requireCreateEnabled(
  env: Env,
  workspaceId: string | null,
): Promise<Response | null> {
  if (await isCreateEnabled(env, workspaceId)) return null;
  return featureDisabledResponse(CREATE_FEATURE);
}

/** Friendly HTML when someone opens /create with the AI creator turned off. */
export function createDisabledPage(signInHref = '/auth/login?redirect=/home'): Response {
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Creator unavailable</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fafaf9;color:#1c1917}
.card{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#57534e;margin:0 0 1.25rem;line-height:1.5}
a{color:#2563eb;text-decoration:none;font-weight:500}a:hover{text-decoration:underline}</style></head>
<body><div class="card"><h1>AI Creator is not available</h1>
<p>Creating artifacts from chat is turned off for this workspace. You can still browse and manage existing artifacts.</p>
<p><a href="/home">Go to My Artifacts</a> · <a href="${signInHref}">Sign in</a></p></div></body></html>`, {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
