import type { Env } from '../types';
import type { PlatformId, WorkspaceSelection } from './types';
import type { SessionCallbackBody, SessionTurnBody } from '../chat-agent/session-do';

/** Stable session key for messaging_links and logging. */
export function buildSessionKey(platform: PlatformId, nativeChatId: number | string): string {
  return `${platform}:${nativeChatId}`;
}

/**
 * Durable Object id for a session. Telegram keeps the legacy bare chatId so
 * existing conversation history is not orphaned.
 */
export function chatDoInstanceId(platform: PlatformId, nativeChatId: number | string): string {
  if (platform === 'telegram') return String(nativeChatId);
  return buildSessionKey(platform, nativeChatId);
}

export async function enqueueAgentTurn(
  env: Env,
  opts: {
    platform: PlatformId;
    nativeChatId: number | string;
    userId: string;
    text: string;
    updateId: number;
    selectedWorkspaceId?: WorkspaceSelection;
    /** Slack DM channel id for replies (optional; resolved on send if missing). */
    slackChannelId?: string;
    onUnavailable: (message: string) => Promise<void>;
  }
): Promise<void> {
  if (!env.CHAT) {
    await opts.onUnavailable('Chat is temporarily unavailable. Try again shortly.');
    return;
  }

  const sessionKey = buildSessionKey(opts.platform, opts.nativeChatId);
  const stub = env.CHAT.get(env.CHAT.idFromName(chatDoInstanceId(opts.platform, opts.nativeChatId)));
  const body: SessionTurnBody = {
    platform: opts.platform,
    sessionKey,
    nativeChatId: opts.nativeChatId,
    userId: opts.userId,
    text: opts.text,
    selectedWorkspaceId: opts.selectedWorkspaceId,
    updateId: opts.updateId,
    slackChannelId: opts.slackChannelId,
  };
  await stub.fetch('https://chat/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function enqueueCallback(
  env: Env,
  opts: {
    platform: PlatformId;
    nativeChatId: number | string;
    userId: string;
    data: string;
    callbackId: string;
    messageId: number | string;
    updateId: number;
    slackChannelId?: string;
    onUnavailable: (message: string) => Promise<void>;
  }
): Promise<void> {
  if (!env.CHAT) {
    await opts.onUnavailable('Temporarily unavailable. Try again shortly.');
    return;
  }

  const sessionKey = buildSessionKey(opts.platform, opts.nativeChatId);
  const stub = env.CHAT.get(env.CHAT.idFromName(chatDoInstanceId(opts.platform, opts.nativeChatId)));
  const body: SessionCallbackBody = {
    type: 'callback',
    platform: opts.platform,
    sessionKey,
    nativeChatId: opts.nativeChatId,
    userId: opts.userId,
    data: opts.data,
    callbackId: opts.callbackId,
    messageId: opts.messageId,
    updateId: opts.updateId,
    slackChannelId: opts.slackChannelId,
  };
  await stub.fetch('https://chat/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
