/**
 * Update by email: someone emails (or auto-forwards) an Excel/CSV file to the page's own address
 * and one of its datasets updates — the email_sheet_sync job, the Inspector's Automate → "Update
 * by email". Each tool replays the REST routes the Inspector calls (GET/PUT
 * /v1/artifacts/{id}/email-sync[/senders], POST/PATCH/DELETE /v1/jobs) in-process as the caller,
 * so the page-edit, workspace and allowed-sender checks apply unchanged.
 */
import { createFetchContext } from '../router/context';
import { routeEmailSyncApi } from '../router/api/email-sync';
import { handleCreateJob, handleDeleteJob, handleUpdateJob } from '../scheduling/handler';
import { errorText, fail, invalid, ok, readJson, str, type Args, type ToolContext, type ToolDef, type ToolResult } from './tool-kit';

const ARTIFACT_ID = { type: 'string', description: 'The page whose data the emailed file keeps up to date (from list_artifacts).' };

interface Status {
  address: string | null;
  senders: string[];
  datasets: string[];
  you: string | null;
  job: { id: string; dataset: string; sheet: string | null; attachment: string | null; lastRunAt: number | null; lastStatus: string | null; lastError: string | null } | null;
  lastEmail: { from: string; receivedAt: number; files: string[] } | null;
  lastUpdate: { rowCount: number | null; file: string | null; sheet: string | null; at: string | null } | null;
}

async function call(ctx: ToolContext, artifactId: string, method: string, sub = '', body?: unknown) {
  const req = new Request(`${ctx.origin}/v1/artifacts/${encodeURIComponent(artifactId)}/email-sync${sub}`, {
    method,
    headers: { Authorization: ctx.authorization, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await routeEmailSyncApi(createFetchContext(req, ctx.env, ctx.executionCtx));
  return { status: res?.status ?? 404, body: res ? await readJson(res) : {} };
}

const jobRequest = (ctx: ToolContext, method: string, path: string, body?: unknown) => new Request(`${ctx.origin}${path}`, {
  method,
  headers: { Authorization: ctx.authorization, 'Content-Type': 'application/json' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

async function status(ctx: ToolContext, artifactId: string): Promise<Status | ToolResult> {
  const r = await call(ctx, artifactId, 'GET');
  if (r.status === 404) return invalid('That page was not found, or the person cannot edit it. Only people who can edit a page can set this up (list_artifacts shows the right id).');
  if (r.status !== 200) return invalid(errorText(r.body, r.status), { code: r.body.code });
  return r.body as unknown as Status;
}

function senderProblem(body: Record<string, unknown>, status: number): ToolResult {
  const code = String(body.code ?? '');
  if (code === 'BAD_SENDER') return invalid(`“${String(body.param ?? '')}” is not an email address. Ask the person for the exact address of whoever sends the file.`, { code });
  if (code === 'FREE_MAIL_DOMAIN') return invalid('A whole free-mail domain would let anyone with such an address change the page. Ask for the exact addresses instead.', { code });
  if (code === 'NO_SENDERS') return invalid('Ask the person who sends the file (their email address); at least one is needed.', { code });
  return invalid(errorText(body, status), { code });
}

function whenText(v: number | string | null | undefined): string {
  if (v == null) return '';
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

const setEmailSync: ToolDef = {
  name: 'set_email_sync',
  title: 'Update a page by email',
  description: [
    'Turns on (or changes, or stops) updating one of a page’s datasets by email: whoever is allowed emails an Excel (.xlsx) or CSV file',
    'to the page’s own address and the page’s data is replaced by the file’s first tab (or the tab named). No sign-in, no model.',
    'Only the listed senders can update it, and only when their email is verified for their domain; anyone else is bounced.',
    'senders = exact addresses (a whole @gmail.com is refused); required the first time, optional later. dataset defaults to the page’s',
    'most recently written dataset, else "data". Returns the page’s address for the file. A file that cannot be used keeps the previous data',
    'and emails the page owner why. stop=true removes it (the address stops accepting files; the data stays).',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: ARTIFACT_ID,
      senders: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Email addresses allowed to send the file (replaces the list).' },
      dataset: { type: 'string', description: 'The dataset the page reads. Leave out to use the default.' },
      sheet: { type: 'string', description: 'Tab name. Leave out for the first tab.' },
      attachment: { type: 'string', description: 'Only when the email brings several files: a file name, * = anything (ventas*.xlsx).' },
      stop: { type: 'boolean', description: 'true = stop updating by email.' },
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, args: Args) {
    const artifactId = str(args.artifact_id, 100);
    if (!artifactId) return invalid('Nothing changed: artifact_id is required.');
    const st = await status(ctx, artifactId);
    if (!('senders' in st)) return st;

    if (args.stop === true) {
      if (!st.job) return ok('This page was not being updated by email; nothing to stop.');
      const res = await handleDeleteJob(ctx.env, ctx.user, st.job.id);
      if (!res.ok) return fail(`Could not stop it: ${errorText(await readJson(res), res.status)}`);
      return ok('Stopped. The page’s address no longer accepts files, and the page keeps the data it has.', { stopped: true });
    }

    let { address, senders } = st;
    if (Array.isArray(args.senders)) {
      const r = await call(ctx, artifactId, 'PUT', '/senders', { senders: args.senders.map((s) => String(s)) });
      if (r.status !== 200) return senderProblem(r.body, r.status);
      address = String(r.body.address ?? '');
      senders = (r.body.senders as string[]) ?? [];
    }
    if (!senders.length) return invalid('First ask the person who will send the file (their email address), then call again with senders.', { needs_senders: true, suggested: st.you });

    const config: Record<string, string> = st.job
      ? { dataset: st.job.dataset, ...(st.job.sheet ? { sheet: st.job.sheet } : {}), ...(st.job.attachment ? { attachment: st.job.attachment } : {}) }
      : { dataset: st.datasets[0] || 'data' };
    const ds = str(args.dataset, 64), sheet = typeof args.sheet === 'string' ? args.sheet.trim() : null, att = typeof args.attachment === 'string' ? args.attachment.trim() : null;
    if (ds) config.dataset = ds;
    if (sheet !== null) { if (sheet) config.sheet = sheet; else delete config.sheet; }
    if (att !== null) { if (att) config.attachment = att; else delete config.attachment; }

    let jobId = st.job?.id;
    if (!st.job) {
      const res = await handleCreateJob(jobRequest(ctx, 'POST', '/v1/jobs', {
        artifact_id: artifactId, action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config, title: 'Update by email',
      }), ctx.env, ctx.user);
      const body = await readJson(res);
      if (!res.ok) return invalid(errorText(body, res.status), { code: body.code });
      jobId = (body.job as { id?: string } | undefined)?.id;
    } else if (ds || sheet !== null || att !== null) {
      const res = await handleUpdateJob(jobRequest(ctx, 'PATCH', `/v1/jobs/${st.job.id}`, { config }), ctx.env, ctx.user, st.job.id);
      if (!res.ok) return invalid(errorText(await readJson(res), res.status));
    }

    const who = senders.join(' or ');
    return ok([
      `Ready. Give the person this address to copy: ${address}`,
      `Tell them: attach the Excel (.xlsx) or CSV file and send it from ${who}; the page updates a few seconds after it arrives.`,
      'They can also set up an automatic forward in Gmail or Outlook. When they say they sent it, call check_email_sync to confirm.',
    ].join(' '), { address, senders, job_id: jobId, dataset: config.dataset, ...(config.sheet ? { sheet: config.sheet } : {}) });
  },
};

const checkEmailSync: ToolDef = {
  name: 'check_email_sync',
  title: 'Check the last file emailed to a page',
  description: [
    'Reads whether a page updates by email and what the last emailed file did: rows written and when, or the one-sentence reason it could',
    'not be used (in the page owner’s language, with what to do). Also returns the address and who may send. Read-only.',
  ].join(' '),
  inputSchema: { type: 'object', properties: { artifact_id: ARTIFACT_ID }, required: ['artifact_id'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args: Args) {
    const artifactId = str(args.artifact_id, 100);
    if (!artifactId) return invalid('artifact_id is required.');
    const st = await status(ctx, artifactId);
    if (!('senders' in st)) return st;
    if (!st.job) return ok('This page is not updated by email. set_email_sync turns it on.', { on: false });
    const j = st.job, up = st.lastUpdate;
    const ran = j.lastRunAt ? j.lastRunAt * 1000 : 0, wrote = up?.at ? Date.parse(up.at) : 0;
    let text: string;
    if (j.lastStatus === 'failed' && ran > wrote) {
      text = `The last file could not be used (${whenText(j.lastRunAt)}), so the page kept its previous data. Tell the person: ${j.lastError ?? ''}`;
    } else if (up) {
      text = `The page has the data from the last file: ${up.rowCount ?? '?'} rows from ${up.file ?? 'the file'}${up.sheet ? ` (tab “${up.sheet}”)` : ''}, updated ${whenText(j.lastStatus === 'success' && ran > wrote ? j.lastRunAt : up.at)}.`;
    } else {
      text = st.lastEmail ? 'An email arrived but the page has not been updated from it yet.' : `No file has arrived yet. The address is ${st.address}.`;
    }
    return ok(`${text} Allowed senders: ${st.senders.join(', ')}.`, { on: true, address: st.address, senders: st.senders, last_status: j.lastStatus, last_error: j.lastError, last_update: up, last_email: st.lastEmail });
  },
};

export const EMAIL_SYNC_TOOLS: ToolDef[] = [setEmailSync, checkEmailSync];
