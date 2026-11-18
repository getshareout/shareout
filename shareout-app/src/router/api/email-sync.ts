/**
 * GET /v1/artifacts/{id}/email-sync          what the "Update by email" panel shows (+ `you`: the caller's email, the default sender)
 * GET /v1/artifacts/{id}/email-sync/senders  { address, senders }
 * PUT /v1/artifacts/{id}/email-sync/senders  { senders: string[] | string } — who may send the file
 *
 * The page's own address, who may send it, the data the page reads, the last email that arrived,
 * the last one bounced, the data it last wrote, and a state + one sentence saying what to do
 * (email/email-sync-status.ts), for an email_sheet_sync job (delivery/destinations/email-sheet-sync.ts).
 * Owner or editor of a workspace page, like creating the job. PUT turns the inbox on and replaces
 * its allowed senders; it must come before POST /v1/jobs, which refuses an empty list. Exact
 * addresses or a company @domain; never a whole free-mail domain. Errors are in the caller's language.
 */
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { getUserRole } from '../../artifacts/roles';
import { jsonWithApiErrors } from '../../http/api-error';
import { enableInbound, getInboxStatus, setInboundAllowlist } from '../../email/inbox-store';
import { emailSyncStatus } from '../../email/email-sync-status';
import { FREE_MAIL_DOMAINS } from '../../delivery/destinations/email-sheet-sync';
import { localeForRecipient, type Locale } from '../../i18n/locale';

const json = (data: unknown, status = 200, headers?: Record<string, string>) => {
  const res = jsonWithApiErrors(data, status);
  for (const [k, v] of Object.entries(headers ?? {})) res.headers.set(k, v);
  return res;
};
const err = (error: string, code: string, status: number) => json({ error, code }, status);

const ADDRESS = /^[^\s@,;<>"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const DOMAIN = /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const MAX_SENDERS = 20;

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    BAD_SENDER: '“{v}” is not an email address. Write the whole address, for example ana@acme.com.',
    FREE_MAIL_DOMAIN: '“{v}” would let anyone with such an address update this page. Write the whole address instead, for example ana@{d}.',
    NO_SENDERS: 'Add at least one email address: only these people can update the page.',
    TOO_MANY_SENDERS: 'Up to {n} addresses.',
    VALIDATION_ERROR: 'Send { "senders": ["person@company.com"] }.',
    NO_WORKSPACE: 'Updating by email needs a page inside a workspace.',
  },
  es: {
    BAD_SENDER: '“{v}” no es una dirección de email. Escribí la dirección completa, por ejemplo ana@empresa.com.',
    FREE_MAIL_DOMAIN: '“{v}” dejaría que cualquiera con esa clase de dirección cambie el artefacto. Escribí la dirección completa, por ejemplo ana@{d}.',
    NO_SENDERS: 'Agregá al menos una dirección de email: solo esas personas pueden actualizar el artefacto.',
    TOO_MANY_SENDERS: 'Hasta {n} direcciones.',
    VALIDATION_ERROR: 'Mandá { "senders": ["persona@empresa.com"] }.',
    NO_WORKSPACE: 'Actualizar por email necesita un artefacto dentro de un espacio.',
  },
};
const say = (locale: Locale, code: string, vars: Record<string, string | number> = {}) =>
  (COPY[locale][code] ?? COPY.en[code] ?? code).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

export async function routeEmailSyncApi(ctx: FetchContext): Promise<Response | null> {
  const m = ctx.path.match(/^\/v1\/artifacts\/([^/]+)\/email-sync(\/senders)?$/);
  if (!m) return null;
  const artifactId = decodeURIComponent(m[1]);
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return ctx.addCORS(user);
  const art = await ctx.env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  const role = art ? await getUserRole(ctx.env, artifactId, user.id) : null;
  if (!art || (role !== 'owner' && role !== 'editor')) return ctx.addCORS(err('Not found', 'NOT_FOUND', 404));
  const locale = await localeForRecipient(ctx.env, { userId: user.id, workspaceId: art.workspace_id });
  if (!art.workspace_id) return ctx.addCORS(err(say(locale, 'NO_WORKSPACE'), 'NO_WORKSPACE', 422));

  const method = ctx.request.method;
  if (m[2]) {
    if (method === 'PUT') return ctx.addCORS(await putSenders(ctx, artifactId, locale));
    if (method === 'GET') {
      const inbox = await getInboxStatus(ctx.env, artifactId);
      return ctx.addCORS(json({ address: inbox.address, senders: inbox.allowlist || [] }));
    }
    return ctx.addCORS(json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT' }));
  }
  if (method === 'GET') return ctx.addCORS(json({ ...(await emailSyncStatus(ctx.env, artifactId, art.workspace_id, locale)), you: user.email ?? null }));
  return ctx.addCORS(json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' }));
}

/** One sender entry, normalised, or the reason it is refused (in `locale`). */
export function checkSender(raw: string, locale: Locale = 'en'): { value?: string; error?: string; code?: string } {
  const v = raw.trim().toLowerCase();
  if (!ADDRESS.test(v) && !DOMAIN.test(v)) return { error: say(locale, 'BAD_SENDER', { v: raw.trim() }), code: 'BAD_SENDER' };
  if (DOMAIN.test(v) && FREE_MAIL_DOMAINS.has(v.slice(1))) {
    return { error: say(locale, 'FREE_MAIL_DOMAIN', { v, d: v.slice(1) }), code: 'FREE_MAIL_DOMAIN' };
  }
  return { value: v };
}

/** "a@x.com, b@y.com" or ["a@x.com"] → the entries to check. Splits on commas, semicolons and line
 *  breaks only, so "juan perez" stays one (refused) entry instead of becoming "juan". */
export function senderEntries(raw: unknown): string[] | null {
  if (typeof raw === 'string') return raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(raw) && raw.every((s) => typeof s === 'string')) return (raw as string[]).map((s) => s.trim()).filter(Boolean);
  return null;
}

async function putSenders(ctx: FetchContext, artifactId: string, locale: Locale): Promise<Response> {
  let raw: unknown;
  try { raw = ((await ctx.request.json()) as { senders?: unknown } | null)?.senders; } catch { /* below */ }
  const entries = senderEntries(raw);
  if (!entries) return err(say(locale, 'VALIDATION_ERROR'), 'VALIDATION_ERROR', 400);
  const list: string[] = [];
  for (const s of entries) {
    const c = checkSender(s, locale);
    if (!c.value) return json({ error: c.error, code: c.code, param: s }, 400);
    if (!list.includes(c.value)) list.push(c.value);
  }
  if (!list.length) return err(say(locale, 'NO_SENDERS'), 'NO_SENDERS', 400);
  if (list.length > MAX_SENDERS) return err(say(locale, 'TOO_MANY_SENDERS', { n: MAX_SENDERS }), 'TOO_MANY_SENDERS', 400);
  await enableInbound(ctx.env, artifactId);
  await setInboundAllowlist(ctx.env, artifactId, list);
  const inbox = await getInboxStatus(ctx.env, artifactId);
  return json({ address: inbox.address, senders: inbox.allowlist || [] });
}
