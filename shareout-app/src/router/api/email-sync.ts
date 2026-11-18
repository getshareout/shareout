/**
 * GET /v1/artifacts/{id}/email-sync          what the "Update by email" panel shows (+ `you`: the caller's email, the default sender)
 * PUT /v1/artifacts/{id}/email-sync/senders  { senders: string[] } — who may send the file
 *
 * The page's own address, who may send it, the last email that arrived and the data it last
 * wrote, for an email_sheet_sync job (delivery/destinations/email-sheet-sync.ts). Owner or
 * editor of a workspace page, like creating the job. PUT turns the inbox on and replaces its
 * allowed senders; it must come before POST /v1/jobs, which refuses an empty list. Exact
 * addresses or a company @domain; never a whole free-mail domain.
 */
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { getUserRole } from '../../artifacts/roles';
import { jsonWithApiErrors } from '../../http/api-error';
import { enableInbound, getInboxStatus, listInboxMessages, setInboundAllowlist, type StoredAttachment } from '../../email/inbox-store';
import { FREE_MAIL_DOMAINS } from '../../delivery/destinations/email-sheet-sync';

const json = (data: unknown, status = 200) => jsonWithApiErrors(data, status);
const err = (error: string, code: string, status: number) => json({ error, code }, status);

const ADDRESS = /^[^\s@,;<>"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const DOMAIN = /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const MAX_SENDERS = 20;

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
  if (!art.workspace_id) return ctx.addCORS(err('Updating by email needs a page inside a workspace.', 'NO_WORKSPACE', 422));

  if (m[2] && ctx.request.method === 'PUT') return ctx.addCORS(await putSenders(ctx, artifactId));
  if (!m[2] && ctx.request.method === 'GET') return ctx.addCORS(json({ ...(await status(ctx, artifactId, art.workspace_id)), you: user.email ?? null }));
  return ctx.addCORS(err('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
}

async function status(ctx: FetchContext, artifactId: string, workspaceId: string) {
  const { env } = ctx;
  const [inbox, job, names] = await Promise.all([
    getInboxStatus(env, artifactId),
    env.DB.prepare(
      `SELECT id, config, enabled, last_run_at, last_status, last_error FROM scheduled_jobs
        WHERE artifact_id = ? AND action = 'email_sheet_sync' ORDER BY created_at DESC LIMIT 1`,
    ).bind(artifactId).first<{ id: string; config: string; enabled: number; last_run_at: number | null; last_status: string | null; last_error: string | null }>(),
    env.DB.prepare('SELECT name FROM datasets WHERE artifact_id = ? ORDER BY updated_at DESC LIMIT 20').bind(artifactId).all<{ name: string }>(),
  ]);
  const config = job ? (JSON.parse(job.config) as { dataset?: string; sheet?: string; attachment?: string }) : null;
  const [last] = inbox.enabled ? await listInboxMessages(env, artifactId, workspaceId, { limit: 1 }) : [];
  let files: string[] = [];
  try { files = last ? (JSON.parse(last.attachments_json || '[]') as StoredAttachment[]).map((a) => a.filename) : []; } catch { /* none */ }
  const ds = config?.dataset
    ? await env.DB.prepare('SELECT metadata FROM datasets WHERE artifact_id = ? AND name = ?')
      .bind(artifactId, config.dataset).first<{ metadata: string | null }>()
    : null;
  let meta: { rowCount?: number; source?: { provider?: string; file?: string; sheet?: string; syncedAt?: string } } = {};
  try { meta = JSON.parse(ds?.metadata || '{}'); } catch { /* none */ }
  const fromEmail = meta.source?.provider === 'email';
  return {
    address: inbox.address,
    senders: inbox.allowlist || [],
    /** The page's datasets, most recently written first (the setup's default target). */
    datasets: (names.results || []).map((r) => r.name),
    job: job && config ? {
      id: job.id, enabled: job.enabled === 1, dataset: config.dataset ?? null, sheet: config.sheet ?? null, attachment: config.attachment ?? null,
      lastRunAt: job.last_run_at, lastStatus: job.last_status, lastError: job.last_error,
    } : null,
    lastEmail: last ? { from: last.from_addr, subject: last.subject, receivedAt: last.received_at, files } : null,
    lastUpdate: fromEmail ? { rowCount: meta.rowCount ?? null, file: meta.source?.file ?? null, sheet: meta.source?.sheet ?? null, at: meta.source?.syncedAt ?? null } : null,
  };
}

/** One sender entry, normalised, or the reason it is refused. */
export function checkSender(raw: string): { value?: string; error?: string; code?: string } {
  const v = raw.trim().toLowerCase();
  if (!ADDRESS.test(v) && !DOMAIN.test(v)) return { error: `"${raw.trim()}" is not an email address`, code: 'BAD_SENDER' };
  if (DOMAIN.test(v) && FREE_MAIL_DOMAINS.has(v.slice(1))) {
    return { error: `"${v}" would let anyone with such an address update this page; list the exact addresses`, code: 'FREE_MAIL_DOMAIN' };
  }
  return { value: v };
}

async function putSenders(ctx: FetchContext, artifactId: string): Promise<Response> {
  let senders: unknown;
  try { senders = ((await ctx.request.json()) as { senders?: unknown } | null)?.senders; } catch { /* below */ }
  if (!Array.isArray(senders) || !senders.every((s) => typeof s === 'string')) {
    return err('Send { "senders": ["person@company.com"] }', 'VALIDATION_ERROR', 400);
  }
  const list: string[] = [];
  for (const s of senders as string[]) {
    if (!s.trim()) continue;
    const c = checkSender(s);
    if (!c.value) return json({ error: c.error, code: c.code, param: s.trim() }, 400);
    if (!list.includes(c.value)) list.push(c.value);
  }
  if (!list.length) return err('Add at least one email address: only these people can update the page.', 'NO_SENDERS', 400);
  if (list.length > MAX_SENDERS) return err(`Up to ${MAX_SENDERS} senders.`, 'TOO_MANY_SENDERS', 400);
  await enableInbound(ctx.env, artifactId);
  await setInboundAllowlist(ctx.env, artifactId, list);
  const inbox = await getInboxStatus(ctx.env, artifactId);
  return json({ address: inbox.address, senders: inbox.allowlist || [] });
}
