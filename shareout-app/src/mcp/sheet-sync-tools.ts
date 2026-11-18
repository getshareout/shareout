/**
 * Spreadsheet syncs: keep one of a page's datasets fresh from a spreadsheet, the two ways the
 * Inspector offers (Automate → Sync data):
 * - a link shared as "Anyone with the link can view" (public_sheet_sync, no Google sign-in)
 * - a private Drive file the person picked in Google's own consent + Picker (drive_file_sync)
 *
 * Each tool replays the REST route the Inspector calls — POST /v1/workspaces/{ws}/sheet-links/inspect,
 * GET /v1/workspaces/{ws}/file-imports/sheet-sync, POST/PATCH/DELETE /v1/jobs, POST /v1/jobs/{id}/run —
 * in-process as the caller, so the membership, import and page-edit checks apply unchanged.
 * Picking a private file stays a person's click in their own browser: the tool hands over the
 * link and reads the pick back afterwards; nothing here goes around Google's consent.
 */
import { createFetchContext } from '../router/context';
import { routeSheetLinkApi } from '../router/api/sheet-links';
import { routeFileImportApi } from '../file-imports/routes';
import { handleCreateJob, handleDeleteJob, handleRunJob, handleUpdateJob } from '../scheduling/handler';
import { listJobsForArtifact } from '../scheduling/jobs/crud';
import type { DriveFileSyncConfig, PublicSheetSyncConfig, ScheduledJob } from '../scheduling/jobs/types';
import { getUserRole } from '../artifacts/roles';
import { localeForRecipient } from '../i18n/locale';
import { PublicLinkError, parseShareLink } from '../data/files/public-sheet-link';
import {
  NOT_MEMBER, errorText, fail, invalid, ok, readJson, resolveWorkspace, str, workspaceChoiceText,
  type Args, type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';

const SYNC_ACTIONS = new Set(['public_sheet_sync', 'drive_file_sync']);
const SHARING_STEPS = 'Share → General access → “Anyone with the link” → Viewer (Google in Spanish: Compartir → Acceso general → “Cualquier persona que tenga el vínculo” → Lector). The link stays the same.';
const PUBLIC_WARNING = 'Anyone who has this link can open the file, so it is only for data that can be public — never personal or confidential data. A private file goes through pick_drive_spreadsheet instead.';
const DATASET_NAME = /^[a-zA-Z0-9_.-]{1,64}$/;
const FREQUENCIES = ['hourly', 'daily', 'weekdays', 'weekly'] as const;
type Frequency = (typeof FREQUENCIES)[number];

const ARTIFACT_ID = { type: 'string', description: 'The page whose data the spreadsheet keeps up to date (from list_artifacts).' };
const WORKSPACE_ID = { type: 'string', description: 'The workspace (id or slug). Optional when the person has only one.' };

// ── replaying the REST routes as the caller ────────────────────────────────

async function replay(
  ctx: ToolContext, route: typeof routeSheetLinkApi, method: string, path: string, body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new Request(`${ctx.origin}${path}`, {
    method,
    headers: { Authorization: ctx.authorization, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });
  const res = await route(createFetchContext(req, ctx.env, ctx.executionCtx));
  return { status: res?.status ?? 404, body: res ? await readJson(res) : {} };
}

const jsonRequest = (ctx: ToolContext, method: string, path: string, body?: unknown) => new Request(`${ctx.origin}${path}`, {
  method,
  headers: { Authorization: ctx.authorization, 'Content-Type': 'application/json' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const wsPath = (ws: string, sub: string) => `/v1/workspaces/${encodeURIComponent(ws)}/${sub}`;

interface Inspected { kind: string; fileName: string | null; sheets: string[]; sheet: string; rowCount: number; columns: string[] }
interface SheetSyncStatus { available: boolean; connected: boolean; accountEmail: string | null; picked: { id: string; name: string; pickedAt: string | null } | null }

/** What went wrong with a link, in words the person can act on. */
function linkProblem(status: number, body: Record<string, unknown>): ToolResult {
  const code = String(body.code ?? '');
  if (code === 'NOT_PUBLIC') {
    return invalid(`The spreadsheet is not shared with “Anyone with the link”, so ShareOut cannot read it (NOT_PUBLIC). In Google: ${SHARING_STEPS} For a private file, pick_drive_spreadsheet lets the person choose it in Google instead.`, { code });
  }
  if (code === 'NOT_FOUND') return invalid('Google cannot find this file (NOT_FOUND): the link is incomplete or the file was deleted. Copy it again in Google with Share → Copy link.', { code });
  if (code === 'BAD_LINK' || code === 'NOT_SPREADSHEET' || code === 'TOO_LARGE' || code.startsWith('SHEET_') || code === 'RATE_LIMITED') {
    return invalid(`${errorText(body, status)} (${code})`, { code });
  }
  if (status === 403) return fail(NOT_MEMBER);
  return fail(`The link could not be checked: ${errorText(body, status)}`, { status, code });
}

async function pickWorkspaceFor(ctx: ToolContext, args: Args, tool: string): Promise<string | ToolResult> {
  const resolved = await resolveWorkspace(ctx, str(args.workspace_id, 100));
  if (resolved.notMember) return fail(NOT_MEMBER);
  if (resolved.choices) return ok(workspaceChoiceText(tool, resolved.choices), { needs_workspace: true, workspaces: resolved.choices });
  if (!resolved.workspace) return invalid('Syncing a spreadsheet needs a workspace, and the person has none yet.');
  return resolved.workspace.id;
}

/** The pick link for this workspace, opened by the person in their own browser. */
function pickUrl(ctx: ToolContext, ws: string, fileId?: string): string {
  return `${ctx.origin}${wsPath(ws, 'file-imports/sheet-sync/pick')}?return=assistant${fileId ? `&file=${encodeURIComponent(fileId)}` : ''}`;
}

const PICK_STEPS = 'Opening it (signed in to ShareOut — it asks to sign in first if needed), Google asks which account to use and to let ShareOut see only the file they choose, then shows their files: they pick the spreadsheet and press Select. A ShareOut page then says “Spreadsheet picked” and to come back to the conversation.';

async function sheetSyncStatus(ctx: ToolContext, ws: string): Promise<SheetSyncStatus | ToolResult> {
  const r = await replay(ctx, routeFileImportApi, 'GET', wsPath(ws, 'file-imports/sheet-sync'));
  if (r.status === 403 && r.body.code === 'IMPORT_NOT_ALLOWED') {
    return invalid('The person’s role in this workspace cannot connect Google Drive (only admins and editors can). A workspace admin can set up the sync, or make them an editor.', { code: 'IMPORT_NOT_ALLOWED' });
  }
  if (r.status === 403) return fail(NOT_MEMBER);
  if (r.status !== 200) return fail(`Could not read the Google Drive status: ${errorText(r.body, r.status)}`, { status: r.status, code: r.body.code });
  return r.body as unknown as SheetSyncStatus;
}

// ── schedule in plain words → the UTC cron the jobs API takes ──────────────

/** Minutes the zone is ahead of UTC at `at`; null for an unknown zone. */
function zoneOffset(tz: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(at);
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Math.round((Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - Math.floor(at.getTime() / 60000) * 60000) / 60000);
  } catch {
    return null;
  }
}

/** Same rules as the Inspector's schedule picker (afCron): a local time → UTC cron; weekly = Mondays. */
export function cronFor(freq: Frequency, time: string, tz: string, at = new Date()): { cron: string; label: string } | { error: string } {
  if (freq === 'hourly') return { cron: '0 * * * *', label: 'every hour' };
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return { error: 'time must be HH:MM (24-hour), like 08:00.' };
  const offset = zoneOffset(tz, at);
  if (offset === null) return { error: `“${tz}” is not a time zone name (like America/Argentina/Buenos_Aires or UTC).` };
  let mins = Number(m[1]) * 60 + Number(m[2]) - offset;
  const shift = mins < 0 ? -1 : mins >= 1440 ? 1 : 0;
  mins = (mins + 1440) % 1440;
  const base = `${mins % 60} ${Math.floor(mins / 60)}`;
  const at24 = `${m[1].padStart(2, '0')}:${m[2]} ${tz}`;
  if (freq === 'daily') return { cron: `${base} * * *`, label: `every day at ${at24}` };
  if (freq === 'weekdays') return { cron: `${base} * * ${shift < 0 ? '0-4' : shift > 0 ? '2-6' : '1-5'}`, label: `Monday to Friday at ${at24}` };
  return { cron: `${base} * * ${(1 + shift + 7) % 7}`, label: `every Monday at ${at24}` };
}

/** "Sales 2026.xlsx" → "sales_2026", the Inspector's default dataset name. */
export function datasetSlug(name: string | null | undefined): string {
  const s = String(name || '').replace(/\.(xlsx|xlsm|xls|ods|csv)$/i, '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, 64);
  return s || 'data';
}

async function rowsIn(ctx: ToolContext, artifactId: string, dataset: string): Promise<number | null> {
  const row = await ctx.env.DB.prepare('SELECT metadata FROM datasets WHERE artifact_id = ? AND name = ?')
    .bind(artifactId, dataset).first<{ metadata: string | null }>();
  if (!row) return null;
  try {
    const n = (JSON.parse(row.metadata || '{}') as { rowCount?: unknown }).rowCount;
    return typeof n === 'number' ? n : null;
  } catch { return null; }
}

async function runOnce(ctx: ToolContext, jobId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await handleRunJob(ctx.env, ctx.user, jobId);
  const body = await readJson(res);
  const ex = body.execution as { status?: string; error?: string } | undefined;
  if (res.ok && ex?.status === 'success') return { ok: true };
  return { ok: false, error: ex?.error || errorText(body, res.status) };
}

async function findSync(ctx: ToolContext, artifactId: string, jobId: string): Promise<ScheduledJob | null> {
  const jobs = await listJobsForArtifact(ctx.env, artifactId, ctx.user.id);
  return jobs.find((j) => j.id === jobId && SYNC_ACTIONS.has(j.action)) ?? null;
}

// ── tools ───────────────────────────────────────────────────────────────────

const inspectSheetLink: ToolDef = {
  name: 'inspect_sheet_link',
  title: 'Check a spreadsheet link',
  description: [
    'Checks a Google Sheets or Google Drive (Excel) share link without saving anything: whether it is shared as “Anyone with the link can view”,',
    'the file’s title, its tabs, and the first tab’s row count and column names (up to 50). Reads only from Google’s own hosts, never the pasted URL;',
    'workspace members only, rate-limited per person. Errors: NOT_PUBLIC (not shared with anyone who has the link), NOT_FOUND (deleted or incomplete link),',
    'BAD_LINK (not a Google spreadsheet link). A link-shared file is readable by anyone who has the link, so this path suits only data that can be public.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { link: { type: 'string', description: 'The share link as the person pasted it.' }, workspace_id: WORKSPACE_ID },
    required: ['link'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async run(ctx, args) {
    const link = str(args.link, 2000);
    if (!link) return invalid('Nothing was checked: link is required.');
    const ws = await pickWorkspaceFor(ctx, args, 'inspect_sheet_link');
    if (typeof ws !== 'string') return ws;
    const r = await replay(ctx, routeSheetLinkApi, 'POST', wsPath(ws, 'sheet-links/inspect'), { link });
    if (r.status !== 200) return linkProblem(r.status, r.body);
    const info = r.body as unknown as Inspected;
    const name = info.fileName || 'The spreadsheet';
    const text = [
      `“${name}” is shared with anyone who has the link. Tabs: ${info.sheets.join(', ')}.`,
      `The first tab with data, “${info.sheet}”, has ${info.rowCount} rows${info.columns.length ? `; columns: ${info.columns.join(', ')}` : ''}.`,
      PUBLIC_WARNING,
    ].join(' ');
    return ok(text, { workspace_id: ws, ...info });
  },
};

const pickDriveSpreadsheet: ToolDef = {
  name: 'pick_drive_spreadsheet',
  title: 'Link to choose a private Google Drive spreadsheet',
  description: [
    'For a private spreadsheet in Google Drive (Excel, Google Sheets, OpenDocument or CSV): returns the link the person opens in their own browser to choose the file in Google’s consent screen and file picker,',
    'and the last spreadsheet they already picked in this workspace (name, file_id, when). Changes nothing itself: choosing the file is the person’s click in Google, once per file;',
    'ShareOut then reads only that file (Google’s drive.file access), never the rest of their Drive. link (optional): a Drive or Sheets link narrows the picker to that one file.',
    'Needs a role that may import files in the workspace (admins and editors).',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { workspace_id: WORKSPACE_ID, link: { type: 'string', description: 'Optional: the file’s Drive or Sheets link, so the picker shows only that file.' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const ws = await pickWorkspaceFor(ctx, args, 'pick_drive_spreadsheet');
    if (typeof ws !== 'string') return ws;
    let fileId: string | undefined;
    const link = str(args.link, 2000);
    if (link) {
      try { fileId = parseShareLink(link).id; } catch (e) { return invalid(e instanceof PublicLinkError ? e.message : 'That is not a Google Drive or Sheets link.'); }
    }
    const status = await sheetSyncStatus(ctx, ws);
    if (!('available' in status)) return status;
    if (!status.available) return invalid('Google Drive is not set up on this ShareOut instance, so a private file cannot be picked. A link shared as “Anyone with the link” works instead (inspect_sheet_link), for data that can be public.');
    const url = pickUrl(ctx, ws, fileId);
    const picked = status.picked;
    const text = [
      `Pick link: ${url}`,
      PICK_STEPS,
      picked
        ? `Last spreadsheet picked in this workspace: “${picked.name}” (file_id ${picked.id})${picked.pickedAt ? `, at ${picked.pickedAt}` : ''}.`
        : 'No spreadsheet has been picked in this workspace yet.',
    ].join('\n');
    return ok(text, { workspace_id: ws, pick_url: url, connected: status.connected, picked });
  },
};

const setSheetSync: ToolDef = {
  name: 'set_sheet_sync',
  title: 'Keep a page’s data in sync with a spreadsheet',
  description: [
    'Creates or changes the schedule that copies one tab of a spreadsheet into one of a page’s datasets (JSON rows keyed by the header row, read in the page with sdk.dataset(name)).',
    'Source: link (a Google Sheets/Drive link shared as “Anyone with the link”) or file_id (a private Drive file the person already picked, from pick_drive_spreadsheet).',
    'Defaults: the first tab with data, a dataset named after the file (“Sales 2026.xlsx” → sales_2026), daily at 08:00 UTC. how_often: hourly, daily, weekdays or weekly (Mondays); time and timezone set the hour.',
    'run_now (default true) loads the data once right away and reports the row count; a new schedule whose first load fails is removed again and the reason returned.',
    'job_id changes an existing sync on the page (from list_jobs) instead of creating one. Needs owner or editor access to the page; up to 5 new schedules per person per day.',
    'Each run skips the write when the spreadsheet has not changed.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: ARTIFACT_ID,
      link: { type: 'string', description: 'A Google Sheets or Drive share link set to “Anyone with the link can view”.' },
      file_id: { type: 'string', description: 'A private Drive spreadsheet the person picked (pick_drive_spreadsheet → picked.id).' },
      sheet: { type: 'string', description: 'Tab name. Default: the first tab with data.' },
      dataset: { type: 'string', description: 'Dataset name the page reads (letters, digits, _ . -, up to 64). Default: from the file name.' },
      how_often: { type: 'string', enum: [...FREQUENCIES], default: 'daily' },
      time: { type: 'string', description: 'HH:MM, 24-hour, in timezone. Default 08:00. Ignored for hourly.' },
      timezone: { type: 'string', description: 'IANA time zone, like America/Argentina/Buenos_Aires. Default UTC.' },
      job_id: { type: 'string', description: 'An existing sync on this page to change (from list_jobs).' },
      run_now: { type: 'boolean', default: true },
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const artifactId = str(args.artifact_id, 100);
    if (!artifactId) return invalid('Nothing was done: artifact_id is required.');
    const link = str(args.link, 2000);
    const fileId = str(args.file_id, 200);
    if (link && fileId) return invalid('Nothing was done: send either link (a shared link) or file_id (a picked Drive file), not both.');
    const sheet = str(args.sheet, 100);
    const dataset = str(args.dataset, 64);
    if (dataset && !DATASET_NAME.test(dataset)) return invalid('Nothing was done: dataset may use letters, digits, _ . and -, up to 64 characters.');
    const runNow = args.run_now !== false;

    const role = await getUserRole(ctx.env, artifactId, ctx.user.id);
    if (role !== 'owner' && role !== 'editor') return invalid('Nothing was done: only the page’s owner or editors can keep its data in sync with a spreadsheet, and the person is neither (or the page does not exist).');
    const art = await ctx.env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?').bind(artifactId).first<{ workspace_id: string | null }>();
    const ws = art?.workspace_id;
    if (!ws) return invalid('Nothing was done: syncing a spreadsheet needs a page inside a workspace, and this one is in the personal space.');

    let schedule: { cron: string; label: string } | undefined;
    if (args.how_often !== undefined || args.time !== undefined || args.timezone !== undefined || !args.job_id) {
      const s = cronFor((args.how_often as Frequency) || 'daily', str(args.time, 5) || '08:00', str(args.timezone, 64) || 'UTC');
      if ('error' in s) return invalid(`Nothing was done: ${s.error}`);
      schedule = s;
    }

    const jobId = str(args.job_id, 100);
    if (jobId) return updateSync(ctx, artifactId, ws, jobId, { link, fileId, sheet, dataset, schedule, runNow });
    if (!link && !fileId) return invalid('Nothing was done: send link (a spreadsheet shared as “Anyone with the link”) or file_id (a private Drive file picked with pick_drive_spreadsheet).');

    const locale = await localeForRecipient(ctx.env, { userId: ctx.user.id, workspaceId: ws });
    let action: 'public_sheet_sync' | 'drive_file_sync';
    let config: PublicSheetSyncConfig | DriveFileSyncConfig;
    let fileName: string;
    if (link) {
      // Same check as the Inspector before saving: public? which tabs? It also names the file.
      const r = await replay(ctx, routeSheetLinkApi, 'POST', wsPath(ws, 'sheet-links/inspect'), { link });
      if (r.status !== 200) return linkProblem(r.status, r.body);
      const info = r.body as unknown as Inspected;
      if (sheet && !info.sheets.includes(sheet)) return invalid(`Nothing was done: the spreadsheet has no tab named “${sheet}”. Tabs: ${info.sheets.join(', ')}.`);
      fileName = info.fileName || (locale === 'es' ? 'Planilla compartida' : 'Shared spreadsheet');
      action = 'public_sheet_sync';
      // The tab is kept by name, so a tab added in front later does not change what syncs.
      config = { link, dataset: dataset || datasetSlug(info.fileName), sheet: sheet || info.sheet, ...(info.fileName ? { fileName: info.fileName } : {}) };
    } else {
      const status = await sheetSyncStatus(ctx, ws);
      if (!('available' in status)) return status;
      const picked = status.picked?.id === fileId ? status.picked : null;
      fileName = picked?.name || 'Google Drive spreadsheet';
      action = 'drive_file_sync';
      config = { provider: 'google_drive', fileId: fileId!, dataset: dataset || datasetSlug(picked?.name), ...(picked?.name ? { fileName: picked.name } : {}), ...(sheet ? { sheet } : {}) };
    }

    const title = action === 'public_sheet_sync'
      ? (locale === 'es' ? `Sincronizar ${fileName} desde enlace` : `Sync ${fileName} from link`)
      : (locale === 'es' ? `Sincronizar ${fileName} desde Google Drive` : `Sync ${fileName} from Google Drive`);
    const res = await handleCreateJob(jsonRequest(ctx, 'POST', '/v1/jobs', { artifact_id: artifactId, action, schedule: schedule!.cron, config, title }), ctx.env, ctx.user);
    const body = await readJson(res);
    if (!res.ok) {
      if (res.status === 403) return invalid(`Nothing was done: ${errorText(body, res.status)}`, { code: body.code });
      return invalid(`Nothing was done: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
    }
    const job = body.job as { id: string };
    const summary = { job_id: job.id, action, dataset: config.dataset, sheet: config.sheet ?? null, schedule: schedule!.label, file: fileName };
    if (!runNow) return ok(`Set up: “${fileName}” → dataset “${config.dataset}”, ${schedule!.label}. The first load happens at the next scheduled time.`, summary);

    const run = await runOnce(ctx, job.id);
    if (!run.ok) {
      // Nothing half-made is left behind: the person fixes the cause and it is set up again.
      await handleDeleteJob(ctx.env, ctx.user, job.id);
      const notPicked = action === 'drive_file_sync' && /picker|chosen|choose/i.test(run.error ?? '');
      return invalid(
        `Nothing was set up: the first load failed — ${run.error}${notPicked ? ` The person has to pick this file in Google first: ${pickUrl(ctx, ws, fileId!)}` : ''}`,
        { ...summary, job_id: null, error: run.error, ...(notPicked ? { pick_url: pickUrl(ctx, ws, fileId!) } : {}) },
      );
    }
    const rows = await rowsIn(ctx, artifactId, config.dataset);
    return ok(
      `Done: the page now has ${rows ?? 'the'} rows from “${fileName}” in dataset “${config.dataset}”, and updates ${schedule!.label}${action === 'public_sheet_sync' ? ' (each run skips the write when nothing changed)' : ''}.`,
      { ...summary, row_count: rows },
    );
  },
};

async function updateSync(
  ctx: ToolContext, artifactId: string, ws: string, jobId: string,
  p: { link: string | null; fileId: string | null; sheet: string | null; dataset: string | null; schedule?: { cron: string; label: string }; runNow: boolean },
): Promise<ToolResult> {
  const job = await findSync(ctx, artifactId, jobId);
  if (!job) return invalid('Nothing was changed: this page has no spreadsheet sync with that job_id that the person can see. list_jobs with the page’s artifact_id lists them.');
  const prev = job.config as unknown as PublicSheetSyncConfig & DriveFileSyncConfig;
  if (job.action === 'public_sheet_sync' && p.fileId) return invalid('Nothing was changed: this sync reads a shared link; a private Drive file needs a new sync (set_sheet_sync with file_id, then remove_sheet_sync on this one).');
  if (job.action === 'drive_file_sync' && p.link) return invalid('Nothing was changed: this sync reads a private Drive file; a shared link needs a new sync (set_sheet_sync with link, then remove_sheet_sync on this one).');
  if (p.link) {
    const r = await replay(ctx, routeSheetLinkApi, 'POST', wsPath(ws, 'sheet-links/inspect'), { link: p.link });
    if (r.status !== 200) return linkProblem(r.status, r.body);
  }
  const config = {
    ...prev,
    ...(p.link ? { link: p.link } : {}),
    ...(p.fileId ? { fileId: p.fileId } : {}),
    ...(p.sheet ? { sheet: p.sheet } : {}),
    ...(p.dataset ? { dataset: p.dataset } : {}),
  };
  const changed = Boolean(p.link || p.fileId || p.sheet || p.dataset);
  const patch = { ...(changed ? { config } : {}), ...(p.schedule ? { schedule: p.schedule.cron } : {}) };
  if (!Object.keys(patch).length) return invalid('Nothing was changed: send what to change (sheet, dataset, link, file_id, or how_often/time/timezone).');
  const res = await handleUpdateJob(jsonRequest(ctx, 'PATCH', `/v1/jobs/${encodeURIComponent(jobId)}`, patch), ctx.env, ctx.user, jobId);
  const body = await readJson(res);
  if (!res.ok) return invalid(`Nothing was changed: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
  const what = [p.schedule ? `now updates ${p.schedule.label}` : '', changed ? `reads ${config.sheet ? `tab “${config.sheet}”` : 'the first tab'} into dataset “${config.dataset}”` : ''].filter(Boolean).join(' and ');
  if (!p.runNow) return ok(`Changed: the sync ${what}.`, { job_id: jobId, dataset: config.dataset, sheet: config.sheet ?? null });
  const run = await runOnce(ctx, jobId);
  if (!run.ok) return invalid(`Changed: the sync ${what}, but loading it now failed — ${run.error} The schedule stays and tries again at its next time.`, { job_id: jobId, error: run.error });
  const rows = await rowsIn(ctx, artifactId, config.dataset);
  return ok(`Changed and loaded: the sync ${what}; the page has ${rows ?? 'the'} rows in “${config.dataset}”.`, { job_id: jobId, dataset: config.dataset, row_count: rows });
}

const removeSheetSync: ToolDef = {
  name: 'remove_sheet_sync',
  title: 'Stop a spreadsheet sync',
  description: 'Stops a page’s spreadsheet sync (a shared-link or Google Drive sync; job_id from list_jobs). The data already loaded stays on the page; it just no longer updates. Other kinds of schedules are refused. Needs the sync’s creator or the page’s owner.',
  inputSchema: {
    type: 'object',
    properties: { artifact_id: ARTIFACT_ID, job_id: { type: 'string', description: 'The sync to stop (from list_jobs).' } },
    required: ['artifact_id', 'job_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(ctx, args) {
    const artifactId = str(args.artifact_id, 100), jobId = str(args.job_id, 100);
    if (!artifactId || !jobId) return invalid('Nothing was done: artifact_id and job_id are both required.');
    const job = await findSync(ctx, artifactId, jobId);
    if (!job) return invalid('Nothing was stopped: this page has no spreadsheet sync with that job_id that the person can see. list_jobs with the page’s artifact_id lists them.');
    const res = await handleDeleteJob(ctx.env, ctx.user, jobId);
    const body = await readJson(res);
    if (!res.ok) return invalid(`Nothing was stopped: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
    return ok(`Stopped: “${job.title || 'the sync'}” no longer updates the page. The data already loaded stays.`, { job_id: jobId, removed: true });
  },
};

export const SHEET_SYNC_TOOLS: ToolDef[] = [inspectSheetLink, pickDriveSpreadsheet, setSheetSync, removeSheetSync];
