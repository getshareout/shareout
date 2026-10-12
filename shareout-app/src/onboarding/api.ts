/** Onboarding HTTP handlers (work/033) — GET status, POST dismiss/skill-ack/celebrate. */
import type { Env } from '../types';
import { hostWorkspaceId } from '../pages/home/host';
import { getOnboardingStatus, getPersonalOnboardingStatus, PERSONAL_WS } from './status';
import { markDismissed, markSkillAck, markCelebrated } from './state';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { jsonError } from '../router/helpers/json-response';

type AuthUser = { id: string; email: string | null };

async function resolveWorkspace(request: Request, env: Env): Promise<string | null> {
  const hostWs = await hostWorkspaceId(request, env);
  if (hostWs) return hostWs;
  return new URL(request.url).searchParams.get('workspace')?.trim() || null;
}

// No workspace context (apex /home) = the personal checklist (PERSONAL_WS). A
// workspace scope must be one the caller belongs to; null means refuse.
async function resolveScope(request: Request, env: Env, userId: string): Promise<string | null> {
  const workspaceId = await resolveWorkspace(request, env);
  if (!workspaceId) return PERSONAL_WS;
  return (await getInternalWorkspaceRole(env, workspaceId, userId)) ? workspaceId : null;
}

const forbidden = () => jsonError('Not a member of this workspace', 'FORBIDDEN', 403);

/** GET /v1/home/onboarding — full checklist status, or { track: null } when no surface. */
export async function handleOnboardingGetApi(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const workspaceId = await resolveWorkspace(request, env);
  const status = workspaceId
    ? await getOnboardingStatus(env, workspaceId, user.id)
    : await getPersonalOnboardingStatus(env, user.id);
  return Response.json(status ?? { track: null });
}

/** POST /v1/home/onboarding/dismiss */
export async function handleOnboardingDismissApi(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const scope = await resolveScope(request, env, user.id);
  if (!scope) return forbidden();
  await markDismissed(env, scope, user.id);
  return Response.json({ ok: true });
}

/** POST /v1/home/onboarding/skill-ack — the "Get the skill" task is not server-observable. */
export async function handleOnboardingSkillAckApi(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const scope = await resolveScope(request, env, user.id);
  if (!scope) return forbidden();
  await markSkillAck(env, scope, user.id);
  return Response.json({ ok: true });
}

/** POST /v1/home/onboarding/celebrate — fired once by the client when it shows the 100% moment. */
export async function handleOnboardingCelebrateApi(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const scope = await resolveScope(request, env, user.id);
  if (!scope) return forbidden();
  await markCelebrated(env, scope, user.id);
  return Response.json({ ok: true });
}
