/**
 * Update by email: someone emails (or auto-forwards) an Excel/CSV file to the page's own address
 * and one of its datasets updates — the email_sheet_sync job, the Inspector's Automate → "Update
 * by email". Each tool replays the REST routes the Inspector calls (GET/PUT
 * /v1/artifacts/{id}/email-sync[/senders], POST/PATCH/DELETE /v1/jobs) in-process as the caller,
 * so the page-edit, workspace and allowed-sender checks apply unchanged.
 */
import { createFetchContext } from '../router/context';
import { checkSender, routeEmailSyncApi, senderEntries } from '../router/api/email-sync';
import { handleCreateJob, handleDeleteJob, handleUpdateJob } from '../scheduling/handler';
import { getUserRole } from '../artifacts/roles';
import { EMAIL_SYNC_LIMITS, datasetWarning, type EmailSyncStatus } from '../email/email-sync-status';
import { datasetNameFrom } from '../delivery/destinations/email-sheet-sync';
import { errorText, fail, invalid, ok, readJson, str, type Args, type ToolContext, type ToolDef, type ToolResult } from './tool-kit';

const PAGE = { type: 'string', description: 'The page whose data the emailed file keeps up to date: its id (from list_artifacts), its link, or its slug.' };
const DATASET_NAME = /^[a-zA-Z0-9_.-]{1,64}$/;
const L = EMAIL_SYNC_LIMITS;
const LIMITS = `${L.fileMb} MB per file, ${L.rows.toLocaleString('en')} rows, ${L.mailMb} MB per email, ${L.perDay} emails a day`;
const snippet = (dataset: string) => `<script src="/sdk/shareout.js"></script>\n<script>(async () => { const sdk = await ShareOut.create();\n  const rows = await sdk.dataset('${dataset}').get();   // [] until the first file arrives\n  /* draw rows (one object per row, keyed by the column titles) */ })();</script>`;

type Status = EmailSyncStatus & { you: string | null };
interface Page { id: string; name: string; slug: string }

const pageUrl = (ctx: ToolContext, p: Page) => `${ctx.origin}/a/${p.slug}/`;

/** "…/a/ventas/", "https://acme.shareout.site/ventas/", "ventas" → "ventas". */
function refFrom(raw: string): string {
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const parts = new URL(raw).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const a = parts.indexOf('a');
    return (a >= 0 && parts[a + 1]) || parts[0] || raw;
  } catch { return raw; }
}

/** The page by id, link or slug, when the person can edit it. A name answers with the pages it matches. */
async function resolvePage(ctx: ToolContext, raw: unknown): Promise<Page | ToolResult> {
  const given = str(raw, 2000);
  if (!given) return invalid('Nothing was done: artifact_id is required (the page’s id, link or slug).', { code: 'MISSING_PAGE' });
  const ref = refFrom(given);
  const sel = `SELECT a.id, a.name, COALESCE(d.slug, a.slug) AS slug FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'`;
  const { results } = await ctx.env.DB.prepare(`${sel} WHERE (a.id = ?1 OR a.slug = ?1 OR d.slug = ?1) AND a.deleted_at IS NULL LIMIT 5`)
    .bind(ref).all<Page>();
  const editable: Page[] = [];
  for (const p of results ?? []) {
    const role = await getUserRole(ctx.env, p.id, ctx.user.id);
    if (role === 'owner' || role === 'editor') editable.push(p);
  }
  if (editable.length === 1) return editable[0];
  if (editable.length > 1) {
    return invalid(`Nothing was done: several pages answer to “${given}”. Call again with one of these ids:\n${editable.map((p) => `- ${p.name} (id ${p.id}, ${pageUrl(ctx, p)})`).join('\n')}`, { code: 'AMBIGUOUS_PAGE', options: editable.map((p) => p.id) });
  }
  // Not an id, link or slug: perhaps the page's name. Answer with the matches; never guess.
  const like = `%${given.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { results: named } = await ctx.env.DB.prepare(`${sel}
     WHERE a.deleted_at IS NULL AND a.name LIKE ?1 ESCAPE '\\'
       AND (a.owner_id = ?2 OR a.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?2))
     ORDER BY a.created_at DESC LIMIT 10`).bind(like, ctx.user.id).all<Page>();
  const matches: Page[] = [];
  for (const p of named ?? []) {
    const role = await getUserRole(ctx.env, p.id, ctx.user.id);
    if (role === 'owner' || role === 'editor') matches.push(p);
  }
  if (matches.length) {
    return invalid(`Nothing was done: “${given}” is a page name, not its id. Pages that match (confirm which one with the person, then call again with its id):\n${matches.map((p) => `- ${p.name} (id ${p.id}, ${pageUrl(ctx, p)})`).join('\n')}`, { code: 'PAGE_NAME', options: matches.map((p) => ({ id: p.id, name: p.name, url: pageUrl(ctx, p) })) });
  }
  return invalid(`No page matches “${given}” that the person can edit (it does not exist, or they cannot edit it). Only people who can edit a page can set this up; list_artifacts shows their pages (pass the id, the link or the slug).`, { code: 'NOT_FOUND' });
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
  if (r.status === 404) return invalid('That page was not found, or the person cannot edit it. Only people who can edit a page can set this up (list_artifacts shows the right id).', { code: 'NOT_FOUND' });
  if (r.status !== 200) return invalid(errorText(r.body, r.status), { code: r.body.code ?? 'ERROR' });
  return r.body as unknown as Status;
}

function senderProblem(body: Record<string, unknown>, status: number): ToolResult {
  const code = String(body.code ?? 'ERROR');
  if (code === 'BAD_SENDER') return invalid(`Nothing changed: “${String(body.param ?? '')}” is not an email address. Ask the person for the whole address of whoever sends the file.`, { code });
  if (code === 'FREE_MAIL_DOMAIN') return invalid('Nothing changed: a whole free-mail domain would let anyone with such an address change the page. Ask for the exact addresses instead.', { code });
  if (code === 'NO_SENDERS') return invalid('Nothing changed: ask the person who sends the file (their email address); at least one is needed.', { code });
  return invalid(`Nothing changed: ${errorText(body, status)}`, { code });
}

function whenText(v: number | string | null | undefined): string {
  if (v == null) return '';
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** Who else writes `name` on the page: another schedule, data from somewhere other than email, or nobody. */
async function datasetOwner(ctx: ToolContext, artifactId: string, name: string): Promise<{ job: string | null } | { rows: number | null } | null> {
  const job = await ctx.env.DB.prepare("SELECT title FROM scheduled_jobs WHERE artifact_id = ? AND action != 'email_sheet_sync' AND json_extract(config, '$.dataset') = ? LIMIT 1")
    .bind(artifactId, name).first<{ title: string | null }>();
  if (job) return { job: job.title };
  const ds = await ctx.env.DB.prepare('SELECT metadata FROM datasets WHERE artifact_id = ? AND name = ?').bind(artifactId, name).first<{ metadata: string | null }>();
  if (!ds) return null;
  let meta: { rowCount?: unknown; source?: { provider?: unknown } } = {};
  try { meta = JSON.parse(ds.metadata || '{}'); } catch { /* unknown source: treat as data */ }
  if (meta.source?.provider === 'email') return null;
  return { rows: typeof meta.rowCount === 'number' ? meta.rowCount : null };
}

const setEmailSync: ToolDef = {
  name: 'set_email_sync',
  title: 'Update a page by email',
  description: [
    'Turns on (or changes, or stops) updating one of a page’s datasets by email: whoever is allowed emails an Excel (.xlsx) or CSV file',
    'to the page’s own address and the page’s data is replaced by the file’s first tab (or the tab named). No sign-in, no model.',
    'Only the listed senders can update it, and only when their email is verified for their domain; anyone else is bounced.',
    'artifact_id: the page’s id, link or slug (a name answers with the pages it matches). senders: exact addresses, a list or one string (a whole @gmail.com is refused);',
    'required the first time, optional later. dataset defaults to the one the page reads (asked back when it reads several).',
    'Each file REPLACES that dataset: when the page already has data under that name from elsewhere, the call is refused (DATASET_EXISTS) until replace_existing is true.',
    `Returns the page’s address for the file. A file that cannot be used keeps the previous data and emails the page owner why. Limits: ${LIMITS}.`,
    'The page shows the data with sdk.dataset(name).get() (one object per row, keyed by the first row; [] until the first file).',
    'stop=true removes it (the address stops accepting files; the data and the sender list stay).',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: PAGE,
      senders: {
        anyOf: [{ type: 'array', items: { type: 'string' }, maxItems: 20 }, { type: 'string' }],
        description: 'Email addresses allowed to send the file (replaces the list): an array, or one string (several separated by commas).',
      },
      dataset: { type: 'string', description: 'The dataset the page reads. Leave out to use the one the page reads.' },
      sheet: { type: 'string', description: 'Tab name. Leave out for the first tab.' },
      attachment: { type: 'string', description: 'Only when the email brings several files: a file name, * = anything (ventas*.xlsx).' },
      replace_existing: { type: 'boolean', default: false, description: 'The page already has data under that name: true = each file replaces it (confirm with the person first).' },
      stop: { type: 'boolean', description: 'true = stop updating by email.' },
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  // Every file replaces the dataset it fills.
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(ctx, args: Args) {
    const page = await resolvePage(ctx, args.artifact_id);
    if ('content' in page) return page;
    const st = await status(ctx, page.id);
    if (!('senders' in st)) return st;
    const link = pageUrl(ctx, page);

    if (args.stop === true) {
      if (!st.job) return ok('This page was not being updated by email; nothing to stop.', { stopped: false });
      const res = await handleDeleteJob(ctx.env, ctx.user, st.job.id);
      if (!res.ok) return fail(`Could not stop it: ${errorText(await readJson(res), res.status)}`, { code: 'STOP_FAILED' });
      const kept = ((await readJson(res)).senders_kept as string[] | undefined) ?? st.senders;
      return ok(`Stopped. The page’s address no longer accepts files, and the page keeps the data it has.${kept.length ? ` The list of who may send (${kept.join(', ')}) stays saved for if it is turned on again.` : ''}`, { stopped: true, senders_kept: kept });
    }

    // 1. Who sends it — checked here, saved only once everything else is fine.
    const given = args.senders === undefined ? null : senderEntries(args.senders);
    if (args.senders !== undefined && !given) return invalid('Nothing changed: senders must be an email address or a list of them.', { code: 'BAD_SENDER' });
    for (const entry of given ?? []) {
      const c = checkSender(entry);
      if (!c.value) return senderProblem({ code: c.code, param: entry, error: c.error }, 400);
    }
    const senders = given?.length ? [...new Set(given.map((s) => s.trim().toLowerCase()))] : st.senders;
    if (!senders.length) {
      const you = st.you ? ` It may be the person themself (${st.you}).` : '';
      return invalid(`First ask who will send the file and their email address.${you} Then call again with senders.`, { code: 'NEEDS_SENDERS', needs_senders: true, suggested: st.you });
    }

    // 2. Which data the file fills: the one the page reads.
    const config: Record<string, string> = st.job
      ? { dataset: st.job.dataset ?? 'data', ...(st.job.sheet ? { sheet: st.job.sheet } : {}), ...(st.job.attachment ? { attachment: st.job.attachment } : {}) }
      : { dataset: '' };
    const askedDs = str(args.dataset, 200);
    if (askedDs && !DATASET_NAME.test(askedDs)) {
      return invalid(`Nothing changed: “${askedDs}” cannot be a dataset name (letters, digits, _ . -, up to 64). Use, for example, ${datasetNameFrom(askedDs)} — and the same name in the page’s sdk.dataset('…').`, { code: 'BAD_DATASET_NAME', suggestion: datasetNameFrom(askedDs) });
    }
    if (askedDs) config.dataset = askedDs;
    else if (!st.job) {
      if (!st.suggestedDataset) {
        return invalid(`Nothing changed yet: the page shows several sets of data (${(st.reads ?? []).join(', ')}). Ask the person which table the emailed file should fill, in their words, then call again with dataset.`, { code: 'NEEDS_DATASET', options: st.reads ?? [] });
      }
      config.dataset = st.suggestedDataset;
    }
    const sheet = typeof args.sheet === 'string' ? args.sheet.trim() : null;
    const att = typeof args.attachment === 'string' ? args.attachment.trim() : null;
    if (sheet !== null) { if (sheet) config.sheet = sheet; else delete config.sheet; }
    if (att !== null) { if (att) config.attachment = att; else delete config.attachment; }

    // 3. Never replace data the page already has without being asked to.
    const newTarget = !st.job || config.dataset !== st.job.dataset;
    if (newTarget) {
      const owner = await datasetOwner(ctx, page.id, config.dataset);
      if (owner && 'job' in owner) {
        return invalid(`Nothing changed: another schedule on this page${owner.job ? ` (“${owner.job}”)` : ''} already fills “${config.dataset}”; two would overwrite each other. Use another dataset, or change that schedule.`, { code: 'DATASET_IN_USE', dataset: config.dataset });
      }
      if (owner && args.replace_existing !== true) {
        return invalid(`Nothing changed: the page already shows ${owner.rows ?? 'some'} rows of data under “${config.dataset}”, and each emailed file would REPLACE them. Ask the person to confirm, then call again with replace_existing: true.`, { code: 'DATASET_EXISTS', dataset: config.dataset, row_count: owner.rows });
      }
    }

    // 4. Save: who may send, then the job.
    const sameSenders = given === null || (senders.length === st.senders.length && senders.every((s) => st.senders.includes(s)));
    const configChanged = !!st.job && JSON.stringify(config) !== JSON.stringify({ dataset: st.job.dataset, ...(st.job.sheet ? { sheet: st.job.sheet } : {}), ...(st.job.attachment ? { attachment: st.job.attachment } : {}) });
    let address = st.address;
    let saved = st.senders;
    if (!sameSenders || st.state === 'inbox_off' || !st.address) {
      const r = await call(ctx, page.id, 'PUT', '/senders', { senders });
      if (r.status !== 200) return senderProblem(r.body, r.status);
      address = String(r.body.address ?? '');
      saved = (r.body.senders as string[]) ?? senders;
    }
    if (st.job && sameSenders && !configChanged && st.state !== 'inbox_off') {
      return ok(`Already on, nothing changed. The page’s address is ${address}; allowed senders: ${saved.join(', ')}. The page: ${link}`, { unchanged: true, address, senders: saved, job_id: st.job.id, dataset: config.dataset, page_url: link });
    }

    let jobId = st.job?.id;
    if (!st.job) {
      const res = await handleCreateJob(jobRequest(ctx, 'POST', '/v1/jobs', {
        artifact_id: page.id, action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config, title: 'Update by email',
      }), ctx.env, ctx.user);
      const body = await readJson(res);
      if (res.status === 409 && body.job_id) jobId = String(body.job_id);
      else if (!res.ok) return invalid(`Nothing was set up: ${errorText(body, res.status)}`, { code: body.code ?? 'ERROR' });
      else jobId = (body.job as { id?: string } | undefined)?.id;
    } else if (configChanged) {
      const res = await handleUpdateJob(jobRequest(ctx, 'PATCH', `/v1/jobs/${st.job.id}`, { config }), ctx.env, ctx.user, st.job.id);
      if (!res.ok) { const b = await readJson(res); return invalid(`Nothing changed: ${errorText(b, res.status)}`, { code: b.code ?? 'ERROR' }); }
    }

    const warning = datasetWarning('en', config.dataset, st.reads);
    const pageNote = warning
      ? `Note: ${warning}`
      : !st.reads?.length
        ? `Note: the page does not show any data yet. Add this to the page (update_artifact) so it shows the file:\n${snippet(config.dataset)}`
        : '';
    const who = saved.join(' or ');
    return ok([
      `Ready. Give the person this address to copy: ${address}`,
      `Tell them, in their words: send an email from ${who} to that address with the Excel (.xlsx) file attached (a CSV works too). The subject and text do not matter.`,
      'The first tab is read, and its first row holds the column titles. Each file replaces the page’s data; a file that cannot be used keeps the last good data.',
      `Email from anyone else is bounced. Limits: ${LIMITS}. An Outlook rule can forward the file automatically (Gmail’s forwarding needs a confirmation this address cannot answer yet).`,
      `When they say they sent it, call check_email_sync and tell them how many rows arrived. The page: ${link}`,
      pageNote,
    ].filter(Boolean).join('\n'), {
      address, senders: saved, job_id: jobId, dataset: config.dataset, page_url: link,
      ...(config.sheet ? { sheet: config.sheet } : {}), ...(warning ? { warning } : {}),
    });
  },
};

const checkEmailSync: ToolDef = {
  name: 'check_email_sync',
  title: 'Check the last file emailed to a page',
  description: [
    'Reads whether a page updates by email and what the last emailed file did: rows written and when, or the one-sentence reason it could',
    'not be used (in the page owner’s language, with what to do), and the last email that was bounced and why (not on the list, not verified, too big).',
    'Also returns the address and who may send. artifact_id: the page’s id, link or slug. Read-only.',
  ].join(' '),
  inputSchema: { type: 'object', properties: { artifact_id: PAGE }, required: ['artifact_id'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args: Args) {
    const page = await resolvePage(ctx, args.artifact_id);
    if ('content' in page) return page;
    const st = await status(ctx, page.id);
    if (!('senders' in st)) return st;
    if (!st.job) return ok('This page is not updated by email. set_email_sync turns it on.', { on: false, state: st.state });
    const j = st.job, up = st.lastUpdate;
    const ran = j.lastRunAt ? j.lastRunAt * 1000 : 0, wrote = up?.at ? Date.parse(up.at) : 0;
    let text: string;
    if (st.state === 'inbox_off') {
      text = 'The page’s address is off, so emailed files are not arriving. Call set_email_sync again (same senders) to turn it back on.';
    } else if (st.state === 'failed') {
      text = `The last file could not be used (${whenText(j.lastRunAt)}), so the page kept its previous data. Tell the person: ${j.lastError ?? ''}`;
    } else if (up) {
      text = `The page has the data from the last file: ${up.rowCount ?? '?'} rows from ${up.file ?? 'the file'}${up.sheet ? ` (tab “${up.sheet}”)` : ''}, updated ${whenText(j.lastStatus === 'success' && ran > wrote ? j.lastRunAt : up.at)}.`;
    } else {
      text = st.lastEmail ? 'An email arrived but the page has not been updated from it yet.' : `No file has arrived yet. The address is ${st.address}.`;
    }
    const rej = st.lastRejected;
    if (rej && Date.parse(rej.at) > wrote) text += ` The last email that reached the address was bounced (${whenText(rej.at)}). Tell the person: ${rej.message}`;
    if (j.datasetReadByPage === false) text += ` Note: ${datasetWarning('en', j.dataset ?? '', st.reads)}`;
    return ok(`${text} Allowed senders: ${st.senders.join(', ')}.`, {
      on: true, state: st.state, address: st.address, senders: st.senders, last_status: j.lastStatus, last_error: j.lastError,
      last_update: up, last_email: st.lastEmail, last_rejected: rej, page_url: pageUrl(ctx, page),
    });
  },
};

export const EMAIL_SYNC_TOOLS: ToolDef[] = [setEmailSync, checkEmailSync];
