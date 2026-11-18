import type { Env } from '../../types';
import type { Destination, DeliveryStep } from '../types';
import type { EmailSheetSyncConfig } from '../../scheduling/jobs/types';
import { SHEET_ROWS_MAX, SheetRowsError, sheetRows, sheetRowsKey } from '../../data/files/sheet-rows';
import { XLSX_MAX_INPUT_BYTES } from '../../data/files/parse-xlsx';
import { writeDatasetRows } from '../../data/datasets/handler';
import { getInboxMessage, getInboxStatus, senderAllowed, type StoredAttachment } from '../../email/inbox-store';
import { localeForRecipient, type Locale } from '../../i18n/locale';
import { getUserRole } from '../../artifacts/roles';

// Someone emails (or auto-forwards) an Excel or CSV file to the page's own address → one tab of it
// replaces one of the page's datasets. No model, no Google: the file comes from the message the
// inbound handler already stored. Mail can be forged, so a run writes only when the sender is on
// the inbox's allowed list AND Cloudflare vouches for the sender's domain (DMARC, or DKIM signed by
// that domain). Nothing in the mail is executed or rendered: the attachment is parsed as cells by
// the same bounded parser as the Drive syncs. Any failure leaves the dataset as it was.

const DATASET_NAME = /^[a-zA-Z0-9_.-]{1,64}$/;
/** A file name, where * matches any run of characters. No regex from users. */
const ATTACHMENT_PATTERN = /^[^/\\\0]{1,100}$/;
const TYPES = ['xlsx', 'csv'] as const;

type Code =
  | 'not_event' | 'no_workspace' | 'no_allowlist' | 'not_allowed' | 'unverified' | 'no_message'
  | 'no_attachment' | 'wrong_type' | 'no_match' | 'too_large' | 'too_many_rows' | 'not_a_sheet' | 'unreadable'
  | 'sheet_not_found' | 'empty' | 'write_failed' | 'no_access';

// What went wrong and what to do, in the words the page owner reads (the run log, the failed-run
// email). {x} placeholders are filled from `vars`.
const COPY: Record<Locale, Record<Code, string>> = {
  en: {
    not_event: 'This updates when someone emails the file to the page’s address. Send it there.',
    no_workspace: 'Updating by email needs a page inside a workspace.',
    no_allowlist: 'Nobody is allowed to send the file yet. Add the email address of the person who sends it.',
    not_allowed: '{sender} isn’t on the list of people who can update this page. Add them, then send the file again.',
    unverified: 'We couldn’t confirm the email really came from {sender}, so nothing changed. Send it straight from that mailbox (not through another account).',
    no_message: 'The email could not be found. Send the file again.',
    no_attachment: 'The email had no file attached. Attach the Excel or CSV file and send it again.',
    wrong_type: 'The email had no Excel (.xlsx) or CSV file (it had: {files}). Attach the spreadsheet and send it again.',
    no_match: 'No attached file is named like “{pattern}” (it had: {files}). Rename the file or change the name in the settings.',
    too_large: '“{file}” is too big (the limit is {max} MB). Send a smaller file, or keep only the tab you need.',
    too_many_rows: '“{file}” has more than {rows} rows. Keep only the rows the page needs and send it again.',
    not_a_sheet: '“{file}” isn’t a real {type} file. Save it again from Excel as .xlsx or .csv and send it.',
    unreadable: '“{file}” could not be read. Open it in Excel, save it again and send it.',
    sheet_not_found: '“{file}” has no tab named “{sheet}” (tabs: {sheets}). Rename the tab or change it in the settings.',
    empty: '“{file}” is empty. Check you attached the right file.',
    write_failed: 'The file was read but the page’s data could not be saved: {detail}',
    no_access: 'The person who turned this on can no longer edit the page, so nothing changed. Someone who can edit it should turn it on again.',
  },
  es: {
    not_event: 'Esto se actualiza cuando alguien manda el archivo a la dirección de la página. Mandalo ahí.',
    no_workspace: 'Actualizar por email necesita una página dentro de un espacio.',
    no_allowlist: 'Todavía nadie puede mandar el archivo. Agregá el email de la persona que lo manda.',
    not_allowed: '{sender} no está en la lista de personas que pueden actualizar esta página. Agregalo y mandá el archivo de nuevo.',
    unverified: 'No pudimos confirmar que el email venía de verdad de {sender}, así que no cambió nada. Mandalo directo desde ese correo (no a través de otra cuenta).',
    no_message: 'No encontramos el email. Mandá el archivo de nuevo.',
    no_attachment: 'El email no tenía ningún archivo adjunto. Adjuntá el Excel o CSV y mandalo de nuevo.',
    wrong_type: 'El email no tenía un Excel (.xlsx) ni un CSV (tenía: {files}). Adjuntá la planilla y mandala de nuevo.',
    no_match: 'Ningún adjunto se llama como “{pattern}” (tenía: {files}). Cambiale el nombre al archivo o cambialo en la configuración.',
    too_large: '“{file}” es demasiado grande (el límite es {max} MB). Mandá un archivo más chico, o dejá solo la pestaña que hace falta.',
    too_many_rows: '“{file}” tiene más de {rows} filas. Dejá solo las filas que necesita la página y mandalo de nuevo.',
    not_a_sheet: '“{file}” no es un archivo {type} de verdad. Guardalo de nuevo desde Excel como .xlsx o .csv y mandalo.',
    unreadable: 'No se pudo leer “{file}”. Abrilo en Excel, guardalo de nuevo y mandalo.',
    sheet_not_found: '“{file}” no tiene una pestaña “{sheet}” (pestañas: {sheets}). Cambiale el nombre a la pestaña o cambiala en la configuración.',
    empty: '“{file}” está vacío. Revisá que adjuntaste el archivo correcto.',
    write_failed: 'El archivo se leyó pero no se pudieron guardar los datos de la página: {detail}',
    no_access: 'La persona que activó esto ya no puede editar la página, así que no cambió nada. Alguien que pueda editarla tiene que activarlo de nuevo.',
  },
};

function say(locale: Locale, code: Code, vars: Record<string, string | number> = {}): string {
  return COPY[locale][code].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

function typeOf(filename: string): (typeof TYPES)[number] | null {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return (TYPES as readonly string[]).includes(ext) ? (ext as (typeof TYPES)[number]) : null;
}

/** "ventas*.xlsx" matches "Ventas noviembre.xlsx": case-insensitive, * = anything. */
export function attachmentMatches(pattern: string, filename: string): boolean {
  const parts = pattern.trim().toLowerCase().split('*');
  const name = filename.toLowerCase();
  if (parts.length === 1) return name === parts[0];
  if (!name.startsWith(parts[0]) || !name.endsWith(parts[parts.length - 1])) return false;
  let at = parts[0].length;
  const end = name.length - parts[parts.length - 1].length;
  for (const mid of parts.slice(1, -1)) {
    const i = name.indexOf(mid, at);
    if (i === -1 || i + mid.length > end) return false;
    at = i + mid.length;
  }
  return at <= end;
}

/** The attachment a run reads: the first .xlsx/.csv (whose name matches `pattern`, when set). */
export function pickAttachment(atts: StoredAttachment[], pattern?: string): { att?: StoredAttachment; code?: Code } {
  if (!atts.length) return { code: 'no_attachment' };
  const sheets = atts.filter((a) => typeOf(a.filename));
  if (!sheets.length) return { code: 'wrong_type' };
  const want = (pattern || '').trim();
  const att = want ? sheets.find((a) => attachmentMatches(want, a.filename)) : sheets[0];
  return att ? { att } : { code: 'no_match' };
}

/** The bytes must be what the name claims: .xlsx is a zip; .csv is text (no zip, markup or NULs). */
function looksLike(type: (typeof TYPES)[number], bytes: Uint8Array): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (type === 'xlsx') return zip;
  if (zip) return false;
  const head = bytes.subarray(0, 4096);
  if (head.includes(0)) return false;
  const start = new TextDecoder('utf-8').decode(head.subarray(0, 64)).replace(/^﻿/, '').trimStart();
  return !start.startsWith('<') && !start.startsWith('{\\rtf');
}

async function workspaceOf(env: Env, artifactId: string): Promise<string | null> {
  const art = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  return art?.workspace_id ?? null;
}

// A whole free-mail domain on the list would let anyone with such an address change the data.
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com',
]);
const isFreeMailDomain = (entry: string) => !entry.slice(1).includes('@') && FREE_MAIL_DOMAINS.has(entry.replace(/^@/, ''));

/** The inbox allowlist as this action honours it: free-mail domain entries do not count. */
async function allowlistOf(env: Env, artifactId: string): Promise<{ senders: string[]; freeMail: string[] }> {
  const { allowlist } = await getInboxStatus(env, artifactId);
  const all = (allowlist || []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { senders: all.filter((s) => !isFreeMailDomain(s)), freeMail: all.filter(isFreeMailDomain) };
}

export const emailSheetSyncDestination: Destination<EmailSheetSyncConfig> = {
  kind: 'email_sheet_sync',

  async validate(env, ctx, config) {
    if (typeof config?.dataset !== 'string' || !DATASET_NAME.test(config.dataset)) {
      return 'email_sheet_sync requires a dataset name (letters, digits, _ . -, up to 64)';
    }
    if (config.sheet !== undefined && (typeof config.sheet !== 'string' || config.sheet.length > 100)) return 'sheet must be a tab name (up to 100 characters)';
    if (config.attachment !== undefined && (typeof config.attachment !== 'string' || (config.attachment.trim() !== '' && !ATTACHMENT_PATTERN.test(config.attachment.trim())))) {
      return 'attachment must be a file name, * matches anything (e.g. "ventas*.xlsx"), up to 100 characters';
    }
    if (!(await workspaceOf(env, ctx.artifactId))) return say('en', 'no_workspace');
    // Anyone can send mail to the address; the allowed list is what makes it safe.
    const { senders, freeMail } = await allowlistOf(env, ctx.artifactId);
    if (freeMail.length) return `"${freeMail[0]}" would let anyone with such an address update this page. List the exact addresses instead (PUT /v1/data/{artifactId}/inbox/allowlist).`;
    if (!senders.length) {
      return 'Add at least one allowed sender first (POST /v1/data/{artifactId}/inbox/enable with {"allowlist": ["person@company.com"]}): only they can update this page by email.';
    }
    return null;
  },

  async deliver(env, ctx, config) {
    const workspaceId = await workspaceOf(env, ctx.artifactId);
    const locale = await localeForRecipient(env, { userId: ctx.createdBy, workspaceId });
    const steps: DeliveryStep[] = [];
    let t0 = Date.now();
    const fail = (step: string, code: Code, vars: Record<string, string | number> = {}) => {
      const error = say(locale, code, vars);
      steps.push({ step, status: 'failed', durationMs: Date.now() - t0, detail: { code, error } });
      return { success: false, error, steps };
    };

    const p = ctx.eventPayload;
    if (ctx.triggeredVia !== 'event' || !p) return fail('receive', 'not_event');
    if (!workspaceId) return fail('receive', 'no_workspace');
    // The data is written on its creator's authority: only while they can still edit the page.
    const role = await getUserRole(env, ctx.artifactId, ctx.createdBy);
    if (role !== 'owner' && role !== 'editor') return fail('receive', 'no_access');

    // 1. Who sent it. The inbound handler already bounced unlisted or unverified senders while the
    //    list was set; this re-checks against the list as it is now.
    const sender = (p.sender || '').toLowerCase();
    const allowlist = (await allowlistOf(env, ctx.artifactId)).senders;
    if (!allowlist.length) return fail('receive', 'no_allowlist');
    if (!p.senderVerified) return fail('receive', 'unverified', { sender: sender || p.from });
    if (!sender || !senderAllowed(sender, allowlist)) return fail('receive', 'not_allowed', { sender: sender || p.from });

    // 2. Which file. Attachments come from the stored message, never from the event payload.
    const row = await getInboxMessage(env, ctx.artifactId, workspaceId, p.messageId);
    if (!row) return fail('receive', 'no_message');
    let atts: StoredAttachment[] = [];
    try { atts = JSON.parse(row.attachments_json || '[]') as StoredAttachment[]; } catch { /* none */ }
    const files = atts.map((a) => a.filename).join(', ') || '—';
    const picked = pickAttachment(atts, config.attachment);
    if (!picked.att) return fail('receive', picked.code!, { files, pattern: (config.attachment || '').trim() });
    const att = picked.att;
    const type = typeOf(att.filename)!;
    const max = XLSX_MAX_INPUT_BYTES / 1_000_000;
    if (att.size > XLSX_MAX_INPUT_BYTES) return fail('receive', 'too_large', { file: att.filename, max });
    const obj = await env.ARTIFACTS.get(att.r2Key);
    if (!obj) return fail('receive', 'no_message');
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (!looksLike(type, bytes)) return fail('receive', 'not_a_sheet', { file: att.filename, type: type === 'xlsx' ? 'Excel' : 'CSV' });
    steps.push({ step: 'receive', status: 'success', durationMs: Date.now() - t0, detail: { file: att.filename, bytes: bytes.byteLength } });

    // 3. Its rows, through the same bounded parser and limits as the Drive syncs.
    t0 = Date.now();
    const sheetWanted = (config.sheet || '').trim();
    let parsed: Awaited<ReturnType<typeof sheetRows>>;
    try {
      parsed = await sheetRows(bytes, sheetWanted);
    } catch (e) {
      const byCode: Record<string, Code> = { TOO_LARGE: 'too_large', TOO_MANY_ROWS: 'too_many_rows', SHEET_NOT_FOUND: 'sheet_not_found', EMPTY: 'empty' };
      const code: Code = (e instanceof SheetRowsError && byCode[e.code]) || 'unreadable';
      const sheets = e instanceof SheetRowsError ? e.sheets.join(', ') : '';
      return fail('transform', code, { file: att.filename, max, sheet: sheetWanted, sheets, rows: SHEET_ROWS_MAX.toLocaleString(locale) });
    }
    const key = await sheetRowsKey(parsed.sheet, parsed.rows);
    const current = await env.DB.prepare('SELECT metadata FROM datasets WHERE artifact_id = ? AND name = ?')
      .bind(ctx.artifactId, config.dataset).first<{ metadata: string | null }>();
    let prevKey: string | undefined;
    try { prevKey = (JSON.parse(current?.metadata || '{}') as { source?: { key?: string } }).source?.key; } catch { /* rewrite it */ }
    steps.push({ step: 'transform', status: 'success', durationMs: Date.now() - t0, detail: { sheet: parsed.sheet, rowCount: parsed.rows.length, unchanged: prevKey === key } });
    if (prevKey === key) return { success: true, steps };

    // 4. Replace the dataset. Metadata is readable by the page's viewers: no sender address in it.
    t0 = Date.now();
    try {
      const res = await writeDatasetRows(env, ctx.artifactId, config.dataset, 'json', parsed.rows, {
        source: { provider: 'email', key, file: att.filename, sheet: parsed.sheet, syncedAt: new Date().toISOString() },
      });
      steps.push({ step: 'deliver', status: 'success', durationMs: Date.now() - t0, detail: { dataset: res.name, version: res.version, rowCount: res.rowCount } });
      return { success: true, steps };
    } catch (e) {
      return fail('deliver', 'write_failed', { detail: e instanceof Error ? e.message : String(e) });
    }
  },
};
