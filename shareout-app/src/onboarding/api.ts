/** Onboarding HTTP handlers (work/033) — GET status, POST dismiss/skill-ack/celebrate. */
import type { Env } from '../types';
import { hostWorkspaceId } from '../pages/home/host';
import { getOnboardingStatus, getPersonalOnboardingStatus, PERSONAL_WS } from './status';
import { markDismissed, markSkillAck, markCelebrated } from './state';

type AuthUser = { id: string; email: string | null };

async function resolveWorkspace(request: Request, env: Env): Promise<string | null> {
  const hostWs = await hostWorkspaceId(request, env);
  if (hostWs) return hostWs;
  return new URL(request.url).searchParams.get('workspace')?.trim() || null;
}

// No workspace context (apex /home) = the personal checklist. State rows key on the
// PERSONAL_WS sentinel so the shared onboarding_state table needs no schema change.
async function resolveScope(request: Request, env: Env): Promise<string> {
  return (await resolveWorkspace(request, env)) ?? PERSONAL_WS;
}

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
  await markDismissed(env, await resolveScope(request, env), user.id);
  return Response.json({ ok: true });
}

/** POST /v1/home/onboarding/skill-ack — the "Get the skill" task is not server-observable. */
export async function handleOnboardingSkillAckApi(request: Request, env: Env, user: AuthUser): Promise<Response> {
  await markSkillAck(env, await resolveScope(request, env), user.id);
  return Response.json({ ok: true });
}

/** POST /v1/home/onboarding/celebrate — fired once by the client when it shows the 100% moment. */
export async function handleOnboardingCelebrateApi(request: Request, env: Env, user: AuthUser): Promise<Response> {
  await markCelebrated(env, await resolveScope(request, env), user.id);
  return Response.json({ ok: true });
}
