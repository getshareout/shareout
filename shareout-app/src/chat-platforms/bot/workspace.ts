import type { Env } from '../../types';
import type { WorkspaceSelection } from '../types';
import type { BotPlatformId } from './links';
import { listWorkspacesForUser, type BotWorkspace } from '../../chat-agent/access';
import { botFeatureFlag } from '../../chat-agent/commands';
import { isFeatureEnabled } from '../../features/flags';

/**
 * Where a chat on Telegram or WhatsApp works: always inside ONE workspace the person is an
 * internal member of and that has the app's assistant turned on — so every answer is billed
 * to that workspace and only its pages are in reach.
 */
export type BotWorkspaceState =
  | { kind: 'ready'; workspace: BotWorkspace }
  | { kind: 'choose'; workspaces: BotWorkspace[] }
  /** `member`: they belong to a workspace, but none has this app's assistant on. */
  | { kind: 'none'; member: boolean };

/** The workspaces this person may chat in on this app (internal member + the app turned on). */
export async function eligibleBotWorkspaces(
  env: Env,
  platform: BotPlatformId,
  userId: string,
): Promise<{ eligible: BotWorkspace[]; all: BotWorkspace[] }> {
  const all = await listWorkspacesForUser(env, userId);
  const flag = botFeatureFlag(platform);
  const on = await Promise.all(all.map((w) => isFeatureEnabled(env, flag, w.id).catch(() => false)));
  return { eligible: all.filter((_, i) => on[i]), all };
}

/**
 * Resolve the workspace for this turn. A stored choice is re-checked every time (membership
 * and the admin's switch can change); with a single eligible workspace it is picked for them.
 */
export async function resolveBotWorkspace(
  env: Env,
  platform: BotPlatformId,
  userId: string,
  selected: WorkspaceSelection,
  persist: (workspaceId: string) => Promise<void>,
): Promise<BotWorkspaceState> {
  const { eligible, all } = await eligibleBotWorkspaces(env, platform, userId);
  const current = typeof selected === 'string' ? eligible.find((w) => w.id === selected) : undefined;
  if (current) return { kind: 'ready', workspace: current };
  if (eligible.length === 1) {
    await persist(eligible[0].id);
    return { kind: 'ready', workspace: eligible[0] };
  }
  if (eligible.length > 1) return { kind: 'choose', workspaces: eligible };
  return { kind: 'none', member: all.length > 0 };
}

/** A workspace by id, slug or name (exact first, then a name that contains it). */
export function findBotWorkspace(workspaces: BotWorkspace[], raw: string): BotWorkspace | null {
  const arg = raw.trim().toLowerCase();
  if (!arg) return null;
  return workspaces.find((w) => w.id.toLowerCase() === arg || w.slug.toLowerCase() === arg || w.name.toLowerCase() === arg)
    || workspaces.find((w) => w.name.toLowerCase().includes(arg))
    || null;
}
