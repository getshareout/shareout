import type { Env } from '../types';
import { getPlatformOrigin } from '../config/origins';
import { resolveSuperadminTelegramChatIds, superadminBotToken } from './recipients';
import { sendMessage, sendPhoto } from '../telegram/client';
import { renderHtmlToPng } from '../screenshots';
import type { DailyPlatformDigest } from './digest';
import { buildBriefDashboardHtml, formatBriefTables } from './brief-visual';

const DEDUP_PREFIX = 'ceo-brief:sent:';
const DEDUP_TTL_SEC = 20 * 3600; // one send per report day

export interface DeliverCeoBriefResult {
  delivered: boolean;
  skippedDuplicate?: boolean;
  sentChart: boolean;
  sentTables: boolean;
  sentNotes: boolean;
  error?: string;
}

async function markSent(env: Env, reportDate: string): Promise<void> {
  if (!env.RATE_LIMIT_KV) return;
  await env.RATE_LIMIT_KV.put(DEDUP_PREFIX + reportDate, String(Date.now()), {
    expirationTtl: DEDUP_TTL_SEC,
  }).catch(() => {});
}

async function alreadySent(env: Env, reportDate: string): Promise<boolean> {
  if (!env.RATE_LIMIT_KV) return false;
  const v = await env.RATE_LIMIT_KV.get(DEDUP_PREFIX + reportDate).catch(() => null);
  return v !== null;
}

/** Deliver CEO brief: chart image + data tables + optional analyst notes. Deduped per reportDate. */
export async function deliverCeoBrief(
  env: Env,
  digest: DailyPlatformDigest,
  ceoNotes: string,
  opts: { force?: boolean } = {}
): Promise<DeliverCeoBriefResult> {
  const reportDate = digest.reportDate;
  if (!opts.force && (await alreadySent(env, reportDate))) {
    return { delivered: false, skippedDuplicate: true, sentChart: false, sentTables: false, sentNotes: false };
  }

  const chatIds = await resolveSuperadminTelegramChatIds(env);
  if (chatIds.length === 0) {
    return { delivered: false, sentChart: false, sentTables: false, sentNotes: false, error: 'No linked Telegram chat' };
  }

  const botToken = superadminBotToken(env);

  let sentChart = false;
  let sentTables = false;
  let sentNotes = false;

  try {
    const html = buildBriefDashboardHtml(digest);
    const png = await renderHtmlToPng(env, html, { width: 920, height: 1100 });
    const tables = formatBriefTables(digest);
    const notes = (ceoNotes || '').trim();
    const notesBody = notes
      ? `CEO NOTES · ${reportDate}\n\n${notes}\n\n${getPlatformOrigin(env)}/admin`
      : '';

    for (const chatId of chatIds) {
      if (png) {
        sentChart = (await sendPhoto(env, chatId, png, `shareout-brief-${reportDate}.png`, `CEO Brief · ${reportDate}`, botToken)) || sentChart;
      }
      await sendMessage(env, chatId, tables, botToken);
      sentTables = true;
      if (notesBody) {
        await sendMessage(env, chatId, notesBody.slice(0, 4090), botToken);
        sentNotes = true;
      }
    }

    if (sentTables || sentChart) {
      await markSent(env, reportDate);
    }

    return { delivered: sentChart || sentTables, sentChart, sentTables, sentNotes };
  } catch (err) {
    return {
      delivered: false,
      sentChart,
      sentTables,
      sentNotes,
      error: err instanceof Error ? err.message : 'delivery failed',
    };
  }
}
