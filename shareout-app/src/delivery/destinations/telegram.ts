import type { Env } from '../../types';
import type { TelegramConfig } from '../../scheduling/jobs';
import { getLinkedChatId } from '../../telegram/linking';
import { sendMessage, sendPhoto, sendDocument } from '../../telegram/client';
import { renderArtifactImage, renderArtifactPdf } from '../../screenshots';
import type { Destination, DeliveryContext, DeliveryResult } from '../types';

// Deliver an artifact to Telegram (message / snapshot / PDF). The target is an
// explicit chatId, or — by default — the linked chat of the user the delivery
// acts on behalf of (a metric alert's creator, a job owner). Reuses the bot's
// send helpers and the shared render pipeline.

/** Resolve the destination chat: explicit chatId, else the creator's linked chat. */
async function resolveChatId(env: Env, ctx: DeliveryContext, config: TelegramConfig): Promise<number | null> {
  if (config.chatId) {
    const n = Number(config.chatId);
    return Number.isFinite(n) ? n : null;
  }
  return getLinkedChatId(env, ctx.createdBy);
}

async function artifactMeta(env: Env, artifactId: string): Promise<{ name: string; slug: string } | null> {
  return env.DB.prepare(
    `SELECT a.name, d.slug AS slug FROM artifacts a
       JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      WHERE a.id = ?`
  ).bind(artifactId).first<{ name: string; slug: string }>();
}

function safeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
}

export const telegramDestination: Destination<TelegramConfig> = {
  kind: 'telegram',

  async validate(env, ctx, config) {
    if (!env.TELEGRAM_BOT_TOKEN) return 'Telegram delivery is not available right now';
    if (config.chatId && !Number.isFinite(Number(config.chatId))) return 'chatId must be a numeric Telegram chat id';
    const chatId = await resolveChatId(env, ctx, config);
    if (chatId === null) {
      return 'No linked Telegram chat — open ShareOut → Settings → Connect Telegram first';
    }
    return null;
  },

  async deliver(env, ctx, config): Promise<DeliveryResult> {
    const chatId = await resolveChatId(env, ctx, config);
    if (chatId === null) return { success: false, error: 'No linked Telegram chat for this user' };

    const meta = await artifactMeta(env, ctx.artifactId);
    if (!meta) return { success: false, error: 'Artifact not found' };
    const url = `${env.SHAREOUT_BASE_URL.replace(/\/$/, '')}/a/${meta.slug}/`;
    const mode = config.mode || 'message';
    const caption = config.customMessage || `Update from ${meta.name}`;
    const file = safeFilename(meta.name);

    try {
      if (mode === 'message' || mode === 'both') {
        const body = config.includeArtifactLink === false ? caption : `${caption}\n${url}`;
        await sendMessage(env, chatId, body);
      }

      if (mode === 'snapshot' || mode === 'both') {
        const image = await renderArtifactImage(env, ctx.artifactId, { type: 'png', width: 1280, fullPage: true, idleTimeout: config.waitMs });
        if (!image) return { success: mode === 'both', error: mode === 'both' ? undefined : 'Snapshot render failed' };
        const sent = (await sendPhoto(env, chatId, image, `${file}.png`, caption)) ||
          (await sendDocument(env, chatId, image, `${file}.png`, 'image/png', caption));
        if (!sent) return { success: false, error: 'Telegram rejected the image' };
      } else if (mode === 'pdf') {
        const pdf = await renderArtifactPdf(env, ctx.artifactId, { idleTimeout: config.waitMs });
        if (!pdf) return { success: false, error: 'PDF render failed' };
        if (!(await sendDocument(env, chatId, pdf, `${file}.pdf`, 'application/pdf', caption))) {
          return { success: false, error: 'Telegram rejected the document' };
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: `Telegram delivery failed: ${err}` };
    }
  },
};
