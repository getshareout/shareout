import type { Env } from '../types';
import type { LocaleCopy } from '../i18n';
import { t } from '../i18n';
import { notifyUser } from '../notify/deliver';
import { getPlatformOrigin } from '../config/origins';
import { workspaceOrigin } from '../workspaces/domains/links';
import type { SendOk } from './store';

// Telling the recipient of a direct message outside Home: their linked Telegram, in their
// language, with a link that opens the conversation. Home shows it on its own (Messages menu and
// the bell read the messages API). Best effort — a message is sent even if the ping is not.

const SNIPPET = 300;

const en = {
  line: (who: string, viaAssistant: boolean) => `💬 ${who}${viaAssistant ? ' (through their assistant)' : ''} sent you a message`,
  page: (name: string) => `About "${name}"`,
  reply: 'Reply',
};
const es: typeof en = {
  line: (who, viaAssistant) => `💬 ${who}${viaAssistant ? ' (con su asistente)' : ''} te mandó un mensaje`,
  page: (name) => `Sobre "${name}"`,
  reply: 'Responder',
};
const COPY: LocaleCopy<typeof en> = { en, es };

/** The Home link that opens the conversation with `withUserId`. */
export async function conversationUrl(env: Env, workspaceId: string, withUserId: string): Promise<string> {
  const ws = await env.DB.prepare('SELECT slug FROM workspaces WHERE id = ?').bind(workspaceId).first<{ slug: string | null }>();
  const base = getPlatformOrigin(env);
  const origin = ws?.slug ? await workspaceOrigin(env, base, ws.slug) : base;
  return `${origin}/home#l/messages/${encodeURIComponent(withUserId)}`;
}

export async function notifyDirectMessage(env: Env, workspaceId: string, senderId: string, sent: SendOk): Promise<void> {
  try {
    const sender = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(senderId).first<{ name: string | null; email: string | null }>();
    const who = sender?.name || sender?.email || 'Someone';
    const url = await conversationUrl(env, workspaceId, senderId);
    const { body, sentVia, artifact } = sent.message;
    const snippet = body.length > SNIPPET ? `${body.slice(0, SNIPPET)}…` : body;
    await notifyUser(env, {
      userId: sent.recipient.id,
      actorIds: [senderId],
      workspaceId,
      telegram: (locale) => {
        const c = t(locale, COPY);
        return [c.line(who, sentVia !== 'web'), '', snippet, ...(artifact ? ['', c.page(artifact.name)] : []), '', `${c.reply}: ${url}`].join('\n');
      },
    });
  } catch { /* best-effort */ }
}
