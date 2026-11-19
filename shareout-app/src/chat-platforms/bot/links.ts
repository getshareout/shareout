import type { Env } from '../../types';
import type { WorkspaceSelection } from '../types';

/** Messaging apps a person links to their ShareOut account by sending a one-time code. */
export type BotPlatformId = 'telegram' | 'whatsapp';

// Telegram keeps its original KV prefix so a code minted just before a deploy still works.
const CODE_PREFIX: Record<BotPlatformId, string> = { telegram: 'tg:link:', whatsapp: 'wa:link:' };
const LINK_CODE_TTL_SECONDS = 900; // 15 minutes

function randomCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mint a one-time code bound to a user. Null if KV is unbound. */
export async function mintBotLinkCode(env: Env, platform: BotPlatformId, userId: string): Promise<string | null> {
  if (!env.RATE_LIMIT_KV) return null;
  const code = randomCode();
  await env.RATE_LIMIT_KV.put(CODE_PREFIX[platform] + code, userId, { expirationTtl: LINK_CODE_TTL_SECONDS });
  return code;
}

/** Consume a code: the bound userId, deleted on read (one-time use). Codes never cross platforms. */
export async function consumeBotLinkCode(env: Env, platform: BotPlatformId, code: string): Promise<string | null> {
  if (!env.RATE_LIMIT_KV || !/^[0-9a-f]{32}$/.test(code)) return null;
  const key = CODE_PREFIX[platform] + code;
  const userId = await env.RATE_LIMIT_KV.get(key);
  if (!userId) return null;
  await env.RATE_LIMIT_KV.delete(key);
  return userId;
}

// Links live in `messaging_links`, keyed by (platform, session_key): the Telegram chat id, or
// the WhatsApp user id. `platform_user_id` keeps what the platform calls the person (the
// Telegram chat id, the WhatsApp phone number when they share it).
export async function linkBotSession(
  env: Env,
  platform: BotPlatformId,
  sessionKey: string,
  userId: string,
  platformUserId: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO messaging_links (platform, session_key, user_id, platform_user_id, linked_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(platform, sessionKey, userId, platformUserId, new Date().toISOString()).run();
}

/** The ShareOut user a chat is linked to; null when unlinked or the account is disabled. */
export async function getBotLinkedUserId(env: Env, platform: BotPlatformId, sessionKey: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT ml.user_id FROM messaging_links ml
       JOIN users u ON u.id = ml.user_id AND COALESCE(u.disabled, 0) = 0
      WHERE ml.platform = ? AND ml.session_key = ?`,
  ).bind(platform, sessionKey).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function getBotSelectedWorkspace(env: Env, platform: BotPlatformId, sessionKey: string): Promise<WorkspaceSelection> {
  try {
    const row = await env.DB.prepare(
      `SELECT selected_workspace_id FROM messaging_links WHERE platform = ? AND session_key = ?`,
    ).bind(platform, sessionKey).first<{ selected_workspace_id: string | null }>();
    return row?.selected_workspace_id ?? null;
  } catch {
    // The deploy can briefly run before the D1 migration is applied: the chat asks for a
    // workspace again instead of breaking every turn.
    return null;
  }
}

export async function setBotSelectedWorkspace(
  env: Env,
  platform: BotPlatformId,
  sessionKey: string,
  workspaceId: WorkspaceSelection,
): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE messaging_links SET selected_workspace_id = ? WHERE platform = ? AND session_key = ?`,
    ).bind(workspaceId, platform, sessionKey).run();
  } catch {
    // See getBotSelectedWorkspace.
  }
}

export async function unlinkBotSession(env: Env, platform: BotPlatformId, sessionKey: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM messaging_links WHERE platform = ? AND session_key = ?`).bind(platform, sessionKey).run();
}

export async function countBotLinks(env: Env, platform: BotPlatformId, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messaging_links WHERE platform = ? AND user_id = ?`,
  ).bind(platform, userId).first<{ n: number }>();
  return row?.n ?? 0;
}
