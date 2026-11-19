import type { Env, WorkspaceRole } from '../../types';
import { isFeatureEnabled, setWorkspaceFlag } from '../../features/flags';
import { whatsAppConfigured } from '../../whatsapp/client';
import { countBotLinks } from '../../chat-platforms/bot/links';

export const WHATSAPP_FLAG = 'ai.whatsapp_bot';

export interface WorkspaceWhatsAppState {
  /** The instance has a WhatsApp number set up. */
  available: boolean;
  /** Members of this workspace may chat with the assistant on WhatsApp. */
  enabled: boolean;
  /** The caller's own WhatsApp is connected to their account. */
  linked: boolean;
  connect_url: string;
}

async function state(env: Env, workspaceId: string, userId: string): Promise<WorkspaceWhatsAppState> {
  const [enabled, links] = await Promise.all([
    isFeatureEnabled(env, WHATSAPP_FLAG, workspaceId),
    countBotLinks(env, 'whatsapp', userId).catch(() => 0),
  ]);
  return { available: whatsAppConfigured(env), enabled, linked: links > 0, connect_url: '/settings/whatsapp?go=1' };
}

/** GET: any internal member sees whether WhatsApp is on and how to connect. */
export async function handleGetWorkspaceWhatsApp(env: Env, userId: string, workspaceId: string, role: WorkspaceRole | null): Promise<Response> {
  if (!role) return Response.json({ error: 'Not a member of this workspace', code: 'FORBIDDEN' }, { status: 403 });
  return Response.json(await state(env, workspaceId, userId));
}

/** PUT {enabled}: the workspace's owners and admins turn the WhatsApp assistant on or off for their members. */
export async function handleSetWorkspaceWhatsApp(
  request: Request,
  env: Env,
  userId: string,
  workspaceId: string,
  role: WorkspaceRole | null,
): Promise<Response> {
  if (role !== 'owner' && role !== 'admin') {
    return Response.json({ error: 'Only workspace owners and admins can change this', code: 'FORBIDDEN' }, { status: 403 });
  }
  const body = await request.json<{ enabled?: unknown }>().catch(() => ({}) as { enabled?: unknown });
  if (typeof body.enabled !== 'boolean') {
    return Response.json({ error: 'enabled must be true or false', code: 'INVALID_BODY' }, { status: 400 });
  }
  if (body.enabled && !whatsAppConfigured(env)) {
    return Response.json({ error: 'WhatsApp is not set up on this instance', code: 'WHATSAPP_UNAVAILABLE' }, { status: 409 });
  }
  await setWorkspaceFlag(env, workspaceId, WHATSAPP_FLAG, body.enabled);
  return Response.json(await state(env, workspaceId, userId));
}
