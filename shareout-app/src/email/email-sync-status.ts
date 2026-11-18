/**
 * "Update by email" (email_sheet_sync) as the page's editors and their assistants see it: the
 * page's address, who may send, which data the page actually reads, what the last file did, the
 * recent emails that were bounced, a Gmail forwarding confirmation waiting to be answered, and one
 * state + one sentence saying what to do next. Shared by
 * GET /v1/artifacts/{id}/email-sync (the panel, MCP) and the job routes.
 */
import type { Env } from '../types';
import { localeForRecipient, type Locale } from '../i18n/locale';
import { datasetsPageReads } from '../provenance/handler';
import { XLSX_MAX_INPUT_BYTES } from '../data/files/parse-xlsx';
import { SHEET_ROWS_MAX } from '../data/files/sheet-rows';
import {
  INBOUND_DAILY_LIMIT, INBOUND_MAX_RAW_BYTES, getInboundRejections, getInboxStatus, listInboxMessages, senderAllowed,
  type InboundRejection, type InboundRejectionRecord, type StoredAttachment,
} from './inbox-store';
import { listForwardConfirmations } from './forwarding-confirm';

export type EmailSyncState = 'off' | 'inbox_off' | 'waiting_first_email' | 'ok' | 'failed';

export const EMAIL_SYNC_LIMITS = {
  fileMb: XLSX_MAX_INPUT_BYTES / 1_000_000,
  rows: SHEET_ROWS_MAX,
  mailMb: Math.round(INBOUND_MAX_RAW_BYTES / 1024 / 1024),
  perDay: INBOUND_DAILY_LIMIT,
} as const;

const L = EMAIL_SYNC_LIMITS;

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    off: 'Not on. Add who sends the file to turn it on.',
    inbox_off: 'The page’s address is off, so emailed files are not arriving. Save who sends the file again to turn it back on.',
    waiting: 'No file has arrived yet. Email the Excel file to {address}.',
    ok: 'Up to date: {rows} rows from the last file ({file}).',
    failed: 'The last file could not be used, so the page kept its data. {error}',
    not_allowed: '{from} is not on the list of people who can update this page, so their email was bounced. Add them, or send the file from an address on the list.',
    unverified: 'We could not confirm the email really came from {from}, so it was bounced. Send it straight from that mailbox, not through another account or a forwarding service.',
    too_large: 'The email from {from} was bigger than {mailMb} MB, so it was bounced. Send a smaller file.',
    rate_limited: 'This page already got {perDay} emails today, so the one from {from} was bounced. Send it again tomorrow.',
    inbox_off_rej: 'An email from {from} arrived while the page’s address was off, so it was bounced.',
    not_read: 'The page does not read “{dataset}”, so the emailed file would not show on it. It reads: {reads}. Use one of those names, or change the page to read “{dataset}”.',
    not_runnable: 'This runs by itself when someone emails the file to {address}. There is nothing to run now: send the file there.',
    forwarded_offer: 'A file from {from}, forwarded from {by}, was bounced because {from} is not on the list. Allow {from} and the next one updates the page.',
    forward_confirm: 'Gmail wants to confirm forwarding from {requester} to this page. Open this link and press Confirm on Google’s page: {url}',
  },
  es: {
    off: 'No está activado. Agregá quién manda el archivo para activarlo.',
    inbox_off: 'La dirección del artefacto está apagada, así que los archivos que manden no llegan. Guardá de nuevo quién manda el archivo para volver a activarla.',
    waiting: 'Todavía no llegó ningún archivo. Mandá el Excel a {address}.',
    ok: 'Al día: {rows} filas del último archivo ({file}).',
    failed: 'El último archivo no se pudo usar, así que el artefacto mantiene sus datos. {error}',
    not_allowed: '{from} no está en la lista de personas que pueden actualizar este artefacto, así que su email se rebotó. Agregalo, o mandá el archivo desde una dirección de la lista.',
    unverified: 'No pudimos confirmar que el email venía de verdad de {from}, así que se rebotó. Mandalo directo desde ese correo, no a través de otra cuenta ni de un servicio de reenvío.',
    too_large: 'El email de {from} pesaba más de {mailMb} MB, así que se rebotó. Mandá un archivo más chico.',
    rate_limited: 'Este artefacto ya recibió {perDay} emails hoy, así que el de {from} se rebotó. Mandalo de nuevo mañana.',
    inbox_off_rej: 'Llegó un email de {from} mientras la dirección del artefacto estaba apagada, así que se rebotó.',
    not_read: 'El artefacto no lee “{dataset}”, así que el archivo que manden no se vería. Lee: {reads}. Usá uno de esos nombres, o cambiá el artefacto para que lea “{dataset}”.',
    not_runnable: 'Esto se actualiza solo cuando alguien manda el archivo a {address}. No hay nada que correr ahora: mandá el archivo ahí.',
    forwarded_offer: 'Llegó un archivo de {from} reenviado desde {by}, pero se rebotó porque {from} no está en la lista. Permití {from} y el próximo actualiza el artefacto.',
    forward_confirm: 'Gmail quiere confirmar el reenvío desde {requester} a este artefacto. Abrí este link y tocá Confirmar en la página de Google: {url}',
  },
};

export function emailSyncSay(locale: Locale, key: keyof (typeof COPY)['en'], vars: Record<string, string | number> = {}): string {
  return (COPY[locale][key] ?? COPY.en[key]).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? (L as Record<string, number>)[k] ?? ''));
}

export function rejectionText(locale: Locale, reason: InboundRejection, from: string): string {
  return emailSyncSay(locale, reason === 'inbox_off' ? 'inbox_off_rej' : reason, { from: from || '?' });
}

/** A bounced report its editors can let in with one tap: its sender is verified, it carried a
 *  spreadsheet, and an allowed mailbox auto-forwarded it (forwarding-confirm.ts forwardingMailbox).
 *  The tap adds that exact sender to the list; the next mail from it still has to be verified. */
export function canAllowRejection(r: InboundRejectionRecord): boolean {
  // A whole address only, of the shape PUT …/senders accepts (router/api/email-sync.ts ADDRESS) — the
  // tap must never add a bare @domain, and never offer a quoted or marked-up address it would refuse.
  return r.reason === 'not_allowed' && r.verified === true && r.hasFile === true && !!r.forwardedBy && /^[^\s@,;<>"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(r.from);
}

export function rejectionMessage(locale: Locale, r: InboundRejectionRecord): string {
  return canAllowRejection(r) ? emailSyncSay(locale, 'forwarded_offer', { from: r.from, by: r.forwardedBy ?? '' }) : rejectionText(locale, r.reason, r.from);
}

/** A warning when the page reads named datasets and `dataset` is not one of them; null otherwise. */
export function datasetWarning(locale: Locale, dataset: string, reads: string[] | null): string | null {
  if (!reads?.length || reads.includes(dataset)) return null;
  return emailSyncSay(locale, 'not_read', { dataset, reads: reads.join(', ') });
}

/** The data a new sync should fill: the one the page reads (exactly one), else — when the page
 *  reads no named dataset we can see — its most recent dataset or "data". null = the page reads
 *  several: ask which. */
export function suggestDataset(reads: string[] | null, datasets: string[]): string | null {
  if (reads?.length === 1) return reads[0];
  if (reads && reads.length > 1) return null;
  return datasets[0] || 'data';
}

interface JobRow { id: string; config: string; enabled: number; last_run_at: number | string | null; last_status: string | null; last_error: string | null }

export async function emailSyncStatus(env: Env, artifactId: string, workspaceId: string, locale: Locale) {
  const [inbox, job, names, reads, rejections, confirmations] = await Promise.all([
    getInboxStatus(env, artifactId),
    env.DB.prepare(
      `SELECT id, config, enabled, last_run_at, last_status, last_error FROM scheduled_jobs
        WHERE artifact_id = ? AND action = 'email_sheet_sync' ORDER BY created_at DESC LIMIT 1`,
    ).bind(artifactId).first<JobRow>(),
    env.DB.prepare('SELECT name FROM datasets WHERE artifact_id = ? ORDER BY updated_at DESC LIMIT 20').bind(artifactId).all<{ name: string }>(),
    datasetsPageReads(env, artifactId).catch(() => null),
    getInboundRejections(env, artifactId),
    listForwardConfirmations(env, artifactId),
  ]);
  const datasets = (names.results || []).map((r) => r.name);
  let config: { dataset?: string; sheet?: string; attachment?: string } | null = null;
  try { config = job ? JSON.parse(job.config) : null; } catch { config = {}; }
  const [last] = inbox.enabled ? await listInboxMessages(env, artifactId, workspaceId, { limit: 1 }) : [];
  let files: string[] = [];
  try { files = last ? (JSON.parse(last.attachments_json || '[]') as StoredAttachment[]).map((a) => a.filename) : []; } catch { /* none */ }
  const ds = config?.dataset
    ? await env.DB.prepare('SELECT metadata FROM datasets WHERE artifact_id = ? AND name = ?')
      .bind(artifactId, config.dataset).first<{ metadata: string | null }>()
    : null;
  let meta: { rowCount?: number; source?: { provider?: string; file?: string; sheet?: string; syncedAt?: string } } = {};
  try { meta = JSON.parse(ds?.metadata || '{}'); } catch { /* none */ }
  const lastUpdate = meta.source?.provider === 'email'
    ? { rowCount: meta.rowCount ?? null, file: meta.source?.file ?? null, sheet: meta.source?.sheet ?? null, at: meta.source?.syncedAt ?? null }
    : null;
  // last_run_at reads back as text ("1795018526.0") from D1: hand out a number.
  const lastRunAt = job?.last_run_at == null ? null : Number(job.last_run_at);
  const wroteAt = lastUpdate?.at ? Date.parse(lastUpdate.at) : 0;
  const failedLast = !!job && job.last_status === 'failed' && (!wroteAt || (lastRunAt ?? 0) * 1000 > wroteAt);
  const state: EmailSyncState = !job ? 'off' : !inbox.enabled ? 'inbox_off' : failedLast ? 'failed' : lastUpdate ? 'ok' : 'waiting_first_email';

  // A sender bounced as not on the list who is on it now needs nothing more: drop it.
  const list = (inbox.allowlist || []).map((a) => a.toLowerCase());
  const recentRejected = rejections
    .filter((r) => !(r.reason === 'not_allowed' && list.length && senderAllowed(r.from, list)))
    .map((r) => ({ ...r, message: rejectionMessage(locale, r), canAllow: canAllowRejection(r) }));
  const lastRejected = recentRejected[0] ?? null;
  const forwarding = confirmations.map((c) => ({ ...c, requesterAllowed: list.length ? senderAllowed(c.requester, list) : false }));
  let message = state === 'off' ? emailSyncSay(locale, 'off')
    : state === 'inbox_off' ? emailSyncSay(locale, 'inbox_off')
    : state === 'failed' ? emailSyncSay(locale, 'failed', { error: job?.last_error ?? '' }).trim()
    : state === 'ok' ? emailSyncSay(locale, 'ok', { rows: lastUpdate?.rowCount ?? '?', file: lastUpdate?.file ?? '' })
    : emailSyncSay(locale, 'waiting', { address: inbox.address ?? '' });
  // A bounce after the last good file is what the person needs to hear about — after the failure
  // too, when it came later (they sent it again and it was bounced).
  if (lastRejected && (state === 'ok' || state === 'waiting_first_email') && Date.parse(lastRejected.at) > wroteAt) message = lastRejected.message;
  if (lastRejected && state === 'failed' && Date.parse(lastRejected.at) > (lastRunAt ?? 0) * 1000) message = `${message} ${lastRejected.message}`;
  // Gmail waiting for its confirmation comes first: nothing is forwarded until it is answered.
  const toConfirm = forwarding.find((c) => !c.openedAt);
  if (toConfirm && state !== 'off' && state !== 'inbox_off') message = emailSyncSay(locale, 'forward_confirm', { requester: toConfirm.requester, url: toConfirm.confirmUrl });

  const readByPage = (name: string | undefined) => (!name || !reads?.length ? null : reads.includes(name));
  return {
    state,
    message,
    address: inbox.address,
    senders: inbox.allowlist || [],
    /** The page's datasets, most recently written first. */
    datasets,
    /** The dataset names the live page reads (sdk.dataset('…'), bound elements); null = cannot tell. */
    reads,
    suggestedDataset: config?.dataset ?? suggestDataset(reads, datasets),
    job: job && config ? {
      id: job.id, enabled: job.enabled === 1, dataset: config.dataset ?? null, sheet: config.sheet ?? null, attachment: config.attachment ?? null,
      datasetReadByPage: readByPage(config.dataset),
      lastRunAt, lastStatus: job.last_status, lastError: job.last_error,
    } : null,
    lastEmail: last ? { from: last.from_addr, subject: last.subject, receivedAt: last.received_at, files } : null,
    lastUpdate,
    lastRejected,
    /** The recent bounces, newest first (up to 5; a sender now on the list is left out). */
    recentRejected,
    /** Gmail forwarding confirmations waiting for the page's editors, newest first. */
    forwarding,
    limits: EMAIL_SYNC_LIMITS,
  };
}

export type EmailSyncStatus = Awaited<ReturnType<typeof emailSyncStatus>>;

/** What POST /v1/jobs adds for a new email sync: the address to send to, who may send, and a
 *  warning when the page does not read the data the file will fill. */
export async function emailSyncCreated(env: Env, userId: string, job: { artifact_id: string; config: unknown }) {
  const dataset = String((job.config as { dataset?: unknown } | null)?.dataset ?? '');
  const inbox = await getInboxStatus(env, job.artifact_id);
  const reads = await datasetsPageReads(env, job.artifact_id).catch(() => null);
  const art = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?').bind(job.artifact_id).first<{ workspace_id: string | null }>();
  const warning = datasetWarning(await localeForRecipient(env, { userId, workspaceId: art?.workspace_id ?? null }), dataset, reads);
  return { address: inbox.address, senders: inbox.allowlist ?? [], ...(warning ? { warning } : {}) };
}
