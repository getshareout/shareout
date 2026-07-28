/**
 * Super-admin roster.
 *
 * Two sources, both consulted:
 *   - `INSTANCE_ADMIN_EMAILS` — comma-separated, set on the Worker. This is the one
 *     a self-hoster uses: adding an instance admin should not mean editing a file in
 *     the repo and redeploying a fork.
 *   - `superadmin-recipients.json` — the baked roster, empty in the public tree.
 *     Still read so an operator who prefers a committed roster can keep one, and so
 *     Telegram chat-id overrides have somewhere to live.
 *
 * `SETUP_ADMIN_EMAIL` also counts, so the first admin never locks themselves out.
 */
import type { Env } from '../types';
import { sendMessage } from '../telegram/client';
import roster from '../../superadmin-recipients.json';

export interface SuperAdminRecipient {
  email: string;
  telegramChatId?: number;
}

export const SUPERADMIN_RECIPIENTS: readonly SuperAdminRecipient[] = roster.recipients;

export const SUPERADMIN_EMAILS: readonly string[] = SUPERADMIN_RECIPIENTS.map((r) => r.email);

/** Emails from `INSTANCE_ADMIN_EMAILS`, lowercased and de-blanked. */
export function envAdminEmails(env?: Env): string[] {
  return (env?.INSTANCE_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
}

export function isSuperAdminEmail(email: string | null | undefined, env?: Env): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();
  if (SUPERADMIN_EMAILS.map((e) => e.toLowerCase()).includes(normalized)) return true;
  if (envAdminEmails(env).includes(normalized)) return true;
  const setup = env?.SETUP_ADMIN_EMAIL?.toLowerCase().trim();
  if (setup && setup === normalized) return true;
  return false;
}

/**
 * True when nothing names an instance admin, so the earliest user is treated as one.
 * `env` is optional only because older call sites do not have it — pass it where you
 * can, or an instance configured purely through `INSTANCE_ADMIN_EMAILS` keeps handing
 * admin to whoever signed up first.
 */
export function rosterIsEmpty(env?: Env): boolean {
  return SUPERADMIN_EMAILS.length === 0 && envAdminEmails(env).length === 0;
}

/** Static chat ids from the roster (deduped). Used by notify-admin.sh. */
export function configuredSuperadminTelegramChatIds(): number[] {
  const ids = SUPERADMIN_RECIPIENTS.map((r) => r.telegramChatId).filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n)
  );
  return [...new Set(ids)];
}

const CHAT_CACHE_KEY = 'superadmin:telegram_chats:v1';

/** @ShareOutSuperAdminBot token, falling back to the product bot. */
export function superadminBotToken(env: Env): string | undefined {
  return env.TELEGRAM_ADMIN_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
}

/**
 * All Telegram chat ids that should receive super-admin messages.
 * Merges roster overrides with each recipient's linked chat from D1.
 * `ALERT_TELEGRAM_CHAT_ID` (single id) still wins for dev/staging overrides.
 */
export async function resolveSuperadminTelegramChatIds(env: Env): Promise<number[]> {
  if (env.ALERT_TELEGRAM_CHAT_ID) {
    const n = Number(env.ALERT_TELEGRAM_CHAT_ID);
    return Number.isFinite(n) ? [n] : [];
  }

  if (env.RATE_LIMIT_KV) {
    const cached = await env.RATE_LIMIT_KV.get(CHAT_CACHE_KEY).catch(() => null);
    if (cached) {
      if (cached === 'none') return [];
      try {
        const parsed = JSON.parse(cached) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((v) => Number(v)).filter((n) => Number.isFinite(n));
        }
      } catch {
        // re-resolve below
      }
    }
  }

  const chatIds = new Set<number>(configuredSuperadminTelegramChatIds());

  try {
    const emails = SUPERADMIN_RECIPIENTS.map((r) => r.email.toLowerCase());
    if (emails.length > 0) {
      const placeholders = emails.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT DISTINCT tl.session_key AS chat_id FROM messaging_links tl
         JOIN users u ON u.id = tl.user_id
         WHERE tl.platform = 'telegram' AND lower(u.email) IN (${placeholders})`
      )
        .bind(...emails)
        .all<{ chat_id: string }>();
      for (const row of rows.results ?? []) {
        const n = Number(row.chat_id);
        if (Number.isFinite(n)) chatIds.add(n);
      }
    }
  } catch {
    // keep roster-only ids
  }

  const resolved = [...chatIds];
  if (env.RATE_LIMIT_KV) {
    await env.RATE_LIMIT_KV.put(
      CHAT_CACHE_KEY,
      resolved.length === 0 ? 'none' : JSON.stringify(resolved),
      { expirationTtl: resolved.length === 0 ? 300 : 3600 }
    ).catch(() => {});
  }
  return resolved;
}

async function sendToSuperadminChats(
  env: Env,
  chatIds: number[],
  send: (chatId: number, botToken: string | undefined) => Promise<void>
): Promise<boolean> {
  if (chatIds.length === 0) return false;
  const token = superadminBotToken(env);
  let delivered = false;
  for (const chatId of chatIds) {
    try {
      await send(chatId, token);
      delivered = true;
    } catch {
      // try remaining recipients
    }
  }
  return delivered;
}

/** Send a plain-text message to every super-admin Telegram chat. */
export async function notifySuperadmins(env: Env, text: string): Promise<boolean> {
  const disabled = (env.ADMIN_ALERTS_DISABLED || '').toLowerCase();
  if (disabled === '1' || disabled === 'true' || disabled === 'yes' || disabled === 'on') {
    return false;
  }
  try {
    const chatIds = await resolveSuperadminTelegramChatIds(env);
    return await sendToSuperadminChats(env, chatIds, async (chatId, token) => {
      await sendMessage(env, chatId, text, token);
    });
  } catch {
    return false;
  }
}
