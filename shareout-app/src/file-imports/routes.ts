/**
 * Folder import API. Everything is workspace-scoped and limited to people who may
 * import (canImport: owners, admins, and members while members may create folders).
 * Tokens never leave the server; responses carry only connection summaries.
 *
 * With GOOGLE_DRIVE_SA_KEY set, Google Drive folder import works by sharing: `access:
 * 'share'` browse and sources read as the workspace's own service account (from the
 * path's workspace, after the membership check), so a folder shared with another
 * workspace is a 404 from Google itself. The folder-import UI then hides the OAuth Google
 * consent; its routes stay for instances without the key and for sources made with it.
 *
 *   GET    /v1/workspaces/{ws}/file-imports                       providers, my connections, sources
 *   GET    /v1/workspaces/{ws}/file-imports/connect/{provider}    → 302 to the provider's consent screen
 *   GET    /v1/file-imports/oauth/{provider}/callback             consent lands here (fixed redirect URI)
 *   DELETE /v1/workspaces/{ws}/file-imports/connections/{provider} disconnect (stops every sync through it)
 *   GET    /v1/workspaces/{ws}/file-imports/browse/{provider}?ref=&q=&files=sheets  server-side folder browser
 *          (files=sheets also lists spreadsheets, for the artifact Drive-file sync; Google Drive only)
 *          (access=share&ref=|link= : Google Drive folders shared with this workspace's email)
 *   POST   /v1/workspaces/{ws}/file-imports/share/google_drive    the workspace's own share email (created on first use)
 *   POST   /v1/workspaces/{ws}/file-imports/sources               { provider, ref, name, targetFolderId?, convert?, dailySync?, access?: 'share' }
 *   PATCH  /v1/workspaces/{ws}/file-imports/sources/{id}          { dailySync?, convert?, access?: 'share' }
 *   DELETE /v1/workspaces/{ws}/file-imports/sources/{id}          stop syncing (imported files stay)
 *   POST   /v1/workspaces/{ws}/file-imports/sources/{id}/sync     sync again
 *   GET    /v1/workspaces/{ws}/file-imports/runs/{runId}          progress + per-file errors
 *
 * The spreadsheet sync's own consent (drive.file + the Google Picker inside it, never the
 * folder import's drive.readonly). It returns on the Google Drive callback above:
 *   GET    /v1/workspaces/{ws}/file-imports/sheet-sync               { available, connected, accountEmail }
 *   GET    /v1/workspaces/{ws}/file-imports/sheet-sync/pick?file=    → 302 to Google: consent + Picker, one spreadsheet
 *          (file = a pasted link's id: the Picker shows only that file); the callback posts
 *          `shareout:drive-sheet:picked` { ok, file: { id, name } | null, error } to the opening ShareOut origin only
 *   DELETE /v1/workspaces/{ws}/file-imports/sheet-sync/connection    forget it (scheduled syncs through it stop)
 */
import type { FetchContext } from '../router/context';
import type { Env } from '../types';
import { isAuthUser, requireTokenOrSession } from '../router/helpers/auth-guard';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { jsonWithApiErrors } from '../http/api-error';
import { escapeHtml } from '../html/utils';
import { standalonePageStyles } from '../design-system/standalone-page';
import { DRIVE_FILE_CONSENT, isFileImportProvider, MAX_DAILY_SOURCES_PER_WORKSPACE, type FileImportProvider, type RemoteEntry } from './types';
import { accountEmail, authorizationUrl, configuredProviders, exchangeCode, OAuthGrantError, providerConfig, verifyState, type OAuthState } from './oauth';
import { accessTokenFor, deleteConnection, findConnection, listConnections, saveConnection, type ConnectionRow } from './connections';
import { providerApi } from './providers';
import { DRIVE_FILE_ID, getDriveFile, isSpreadsheet } from './providers/google';
import { canImport } from './mirror';
import { createRun, getRun, getSource, readRun, runView, type RunRow, type SourceRow } from './runs';
import { launchRun } from './launch';
import { AuthExpiredError, ProviderError, RateLimitedError } from './http';
import { generateId } from '../crypto-utils';
import { ShareAccountError, ensureServiceAccount, serviceAccountConfigured, serviceAccountFor, workspaceDriveToken, type ServiceAccountRow } from './service-account';
import { driveIdFromLink, sharedFolders, sharedItem } from './providers/google-shared';
import { googleDrive } from './providers/google';

const json = (data: unknown, status = 200) => jsonWithApiErrors(data, status);
const err = (error: string, code: string, status: number, extra: Record<string, unknown> = {}) => json({ error, code, ...extra }, status);
const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
/** A folder-import consent (never the sheet sync's drive.file one). */
type ImportConnection = ConnectionRow & { provider: FileImportProvider };

export async function routeFileImportApi(ctx: FetchContext): Promise<Response | null> {
  const { path } = ctx;
  const cb = path.match(/^\/v1\/file-imports\/oauth\/([^/]+)\/callback$/);
  if (cb && ctx.request.method === 'GET') return handleCallback(ctx, cb[1]);
  const m = path.match(/^\/v1\/workspaces\/([^/]+)\/file-imports(\/.*)?$/);
  if (!m) return null;
  const res = await handleWorkspace(ctx, decodeURIComponent(m[1]), (m[2] || '').replace(/^\//, ''));
  return ctx.addCORS(res);
}

async function handleWorkspace(ctx: FetchContext, workspaceId: string, sub: string): Promise<Response> {
  const { env, request } = ctx;
  const method = request.method;
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  if (!(await getInternalWorkspaceRole(env, workspaceId, user.id))) return err('Forbidden', 'FORBIDDEN', 403);
  if (!(await canImport(env, workspaceId, user.id))) {
    return err('Only workspace admins and editors can import files', 'IMPORT_NOT_ALLOWED', 403);
  }
  const providers = configuredProviders(env);
  const share = serviceAccountConfigured(env);

  if (sub === 'sheet-sync' || sub.startsWith('sheet-sync/')) return sheetSync(ctx, workspaceId, user.id, sub.slice('sheet-sync'.length));

  if (sub === '' && method === 'GET') return json(await overview(env, workspaceId, user.id, providers));

  if (sub === 'share/google_drive' && method === 'POST') {
    try {
      const sa = await ensureServiceAccount(env, workspaceId, user.id);
      return json({ shareEmail: sa.email });
    } catch (e) {
      if (e instanceof ShareAccountError) return err(e.message, e.code, e.status);
      throw e;
    }
  }

  let m = sub.match(/^connect\/([a-z_]+)$/);
  if (m && method === 'GET') {
    if (!isFileImportProvider(m[1]) || !providers.includes(m[1])) return err('This provider is not set up on this instance', 'PROVIDER_NOT_CONFIGURED', 404);
    const url = await authorizationUrl(env, m[1], workspaceId, user.id);
    return url ? redirect(url) : err('This provider is not set up on this instance', 'PROVIDER_NOT_CONFIGURED', 404);
  }

  m = sub.match(/^connections\/([a-z_]+)$/);
  if (m && method === 'DELETE') {
    if (!isFileImportProvider(m[1])) return err('Unknown provider', 'VALIDATION_ERROR', 400);
    const conn = await findConnection(env, workspaceId, user.id, m[1]);
    if (!conn) return err('Not connected', 'NOT_FOUND', 404);
    await deleteConnection(env, conn);
    return json({ ok: true });
  }

  m = sub.match(/^browse\/([a-z_]+)$/);
  if (m && method === 'GET' && m[1] === 'google_drive' && ctx.url.searchParams.get('access') === 'share') {
    return share ? browseShared(ctx, workspaceId) : err('Google Drive sharing isn\u2019t set up on this instance', 'PROVIDER_NOT_CONFIGURED', 404);
  }
  if (m && method === 'GET') {
    const conn = await connectionFor(env, workspaceId, user.id, m[1], providers);
    if (conn instanceof Response) return conn;
    const ref = ctx.url.searchParams.get('ref') || 'root';
    const q = ctx.url.searchParams.get('q') || undefined;
    const files = ctx.url.searchParams.get('files') === 'sheets' ? 'sheets' as const : undefined;
    return withProvider(env, conn, async (token) => json(await providerApi(conn.provider).browse(token, ref.slice(0, 600), q, { files })));
  }

  if (sub === 'sources' && method === 'POST') return createSource(ctx, workspaceId, user.id, providers, share);

  m = sub.match(/^sources\/([^/]+)(\/sync)?$/);
  if (m) {
    const source = await getSource(env, workspaceId, m[1]);
    if (!source) return err('Import not found', 'NOT_FOUND', 404);
    const readable = !!source.connection_id || source.auth === 'service_account';
    if (m[2] && method === 'POST') {
      if (!readable) return err('Reconnect the drive to sync this folder again', 'CONNECTION_REVOKED', 409);
      const r = await createRun(env, source, 'resync', user.id);
      if ('conflict' in r) return err('This folder is already syncing', 'RUN_IN_PROGRESS', 409, { run: runView(r.conflict) });
      await launchRun(env, ctx.executionCtx, r.runId);
      return json({ run: runView((await getRun(env, r.runId))!) }, 202);
    }
    if (!m[2] && method === 'PATCH') {
      const b = (await request.json().catch(() => ({}))) as { dailySync?: unknown; convert?: unknown; access?: unknown };
      const sets: string[] = [];
      const vals: unknown[] = [];
      // Move an OAuth Google source onto sharing. Same remote ids, so the ledger stays and nothing re-imports.
      if (b.access === 'share' && source.auth !== 'service_account') {
        if (!share || source.provider !== 'google_drive') return err('Only Google Drive folders can switch to sharing on this instance', 'VALIDATION_ERROR', 400);
        const seen = await withShare(env, workspaceId, async (token) => { await sharedItem(token, source.remote_folder_id); return json({}); });
        if (!seen.ok) return seen;
        sets.push("auth = 'service_account'", 'connection_id = NULL', 'remote_drive_id = NULL');
      }
      if (typeof b.dailySync === 'boolean') {
        if (b.dailySync && !source.daily_sync_enabled) {
          if (!readable && b.access !== 'share') return err('Reconnect the drive first', 'CONNECTION_REVOKED', 409);
          const over = await dailyCapReached(env, workspaceId);
          if (over) return err(`At most ${MAX_DAILY_SOURCES_PER_WORKSPACE} folders can sync daily in one workspace`, 'DAILY_SYNC_LIMIT', 409);
        }
        sets.push('daily_sync_enabled = ?', 'next_sync_at = ?');
        vals.push(b.dailySync ? 1 : 0, b.dailySync ? new Date(Date.now() + 24 * 3600_000).toISOString() : null);
      }
      if (typeof b.convert === 'boolean') { sets.push('convert_enabled = ?'); vals.push(b.convert ? 1 : 0); }
      if (!sets.length) return err('Nothing to change', 'VALIDATION_ERROR', 400);
      await env.DB.prepare(`UPDATE file_import_sources SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND workspace_id = ?`)
        .bind(...vals, new Date().toISOString(), source.id, workspaceId).run();
      return json({ source: await sourceView(env, (await getSource(env, workspaceId, source.id))!, user.id) });
    }
    if (!m[2] && method === 'DELETE') {
      const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
      if (source.created_by !== user.id && role !== 'owner' && role !== 'admin') return err('Only the person who set this up, or an admin, can remove it', 'FORBIDDEN', 403);
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE file_import_runs SET status = 'stopped', stop_code = 'SOURCE_DELETED', finished_at = ?, updated_at = ? WHERE source_id = ? AND status IN ('queued', 'walking', 'importing')")
          .bind(now, now, source.id),
        env.DB.prepare('DELETE FROM file_import_sources WHERE id = ? AND workspace_id = ?').bind(source.id, workspaceId),
      ]);
      return json({ ok: true });
    }
  }

  m = sub.match(/^runs\/([^/]+)$/);
  if (m && method === 'GET') {
    const run = await readRun(env, workspaceId, m[1]);
    return run ? json({ run }) : err('Run not found', 'NOT_FOUND', 404);
  }

  return err('Not found', 'NOT_FOUND', 404);
}

async function connectionFor(env: Env, workspaceId: string, userId: string, provider: string, providers: FileImportProvider[]): Promise<ImportConnection | Response> {
  if (!isFileImportProvider(provider) || !providers.includes(provider)) return err('This provider is not set up on this instance', 'PROVIDER_NOT_CONFIGURED', 404);
  const conn = await findConnection(env, workspaceId, userId, provider);
  return (conn as ImportConnection | null) ?? err('Connect this drive first', 'NOT_CONNECTED', 409);
}

// ---- the spreadsheet sync's consent: drive.file + Google Picker ----------------------

async function sheetSync(ctx: FetchContext, workspaceId: string, userId: string, rest: string): Promise<Response> {
  const { env, request } = ctx;
  if (rest === '' && request.method === 'GET') {
    const conn = await findConnection(env, workspaceId, userId, DRIVE_FILE_CONSENT);
    return json({ available: !!providerConfig(env, DRIVE_FILE_CONSENT), connected: !!conn, accountEmail: conn?.account_email ?? null });
  }
  if (rest === '/pick' && request.method === 'GET') {
    const file = ctx.url.searchParams.get('file') || '';
    if (file && !DRIVE_FILE_ID.test(file)) return err('Not a Google Drive file id', 'VALIDATION_ERROR', 400);
    // The popup opens on the page's own origin; the pick is posted back to that origin only.
    const url = await authorizationUrl(env, DRIVE_FILE_CONSENT, workspaceId, userId, { origin: ctx.url.origin, fileIds: file ? [file] : [] });
    return url ? redirect(url) : err('Google Drive is not set up on this instance', 'PROVIDER_NOT_CONFIGURED', 404);
  }
  if (rest === '/connection' && request.method === 'DELETE') {
    const conn = await findConnection(env, workspaceId, userId, DRIVE_FILE_CONSENT);
    if (!conn) return err('Not connected', 'NOT_FOUND', 404);
    await deleteConnection(env, conn);
    return json({ ok: true });
  }
  return err('Not found', 'NOT_FOUND', 404);
}

/** Run a provider call; map provider failures to API errors the UI can show. */
async function withProvider(env: Env, conn: ConnectionRow, fn: (token: string) => Promise<Response>): Promise<Response> {
  try {
    try {
      return await fn(await accessTokenFor(env, conn));
    } catch (e) {
      if (!(e instanceof AuthExpiredError)) throw e;
      return await fn(await accessTokenFor(env, conn, true));
    }
  } catch (e) {
    if (e instanceof AuthExpiredError) return err(e.message, 'CONNECTION_REVOKED', 409);
    if (e instanceof RateLimitedError) return err(e.message, 'RATE_LIMITED', 429);
    if (e instanceof ProviderError) return err(e.status === 403 ? 'You don’t have access to that folder' : 'The drive could not be read', e.code, e.status === 404 ? 404 : 502);
    throw e;
  }
}

const notShared = (email: string) =>
  `ShareOut can\u2019t see that folder yet. Share it with ${email} as Viewer, then check again. If Drive says you can\u2019t share outside your organization, your Google Workspace admin has to allow it.`;

/**
 * Run a Drive call as THIS workspace's service account — the account in the row keyed by
 * the path's workspace id, never another. What it was not shared with is Google's 404.
 */
async function withShare(env: Env, workspaceId: string, fn: (token: string, sa: ServiceAccountRow) => Promise<Response>): Promise<Response> {
  const sa = await serviceAccountFor(env, workspaceId);
  if (!sa || sa.status !== 'ready' || sa.workspace_id !== workspaceId) return err('Open Google Drive sharing first', 'SHARE_EMAIL_MISSING', 409);
  try {
    try {
      return await fn(await workspaceDriveToken(env, sa), sa);
    } catch (e) {
      if (!(e instanceof AuthExpiredError)) throw e;
      return await fn(await workspaceDriveToken(env, sa, true), sa);
    }
  } catch (e) {
    if (e instanceof ShareAccountError) return err(e.message, e.code, e.status);
    if (e instanceof RateLimitedError) return err(e.message, 'RATE_LIMITED', 429);
    if (e instanceof AuthExpiredError) return err('ShareOut couldn\u2019t read Google Drive as this workspace. Try again in a few minutes.', 'SHARE_EMAIL_FAILED', 502);
    if (e instanceof ProviderError) {
      if (e.status === 404) return err(notShared(sa.email), 'NOT_SHARED', 404, { shareEmail: sa.email });
      if (e.status === 400) return err(e.message, e.code, 400);
      return err('Google Drive could not be read', e.code, 502);
    }
    throw e;
  }
}

/** Folders shared with this workspace (`ref=root`), one of their subfolders, or a pasted link. */
async function browseShared(ctx: FetchContext, workspaceId: string): Promise<Response> {
  const link = ctx.url.searchParams.get('link');
  const ref = (ctx.url.searchParams.get('ref') || 'root').slice(0, 600);
  return withShare(ctx.env, workspaceId, async (token, sa) => {
    if (link) {
      const id = driveIdFromLink(link.slice(0, 2000));
      if (!id) return err('Paste the link of a Google Drive folder', 'VALIDATION_ERROR', 400);
      const item = await sharedItem(token, id);
      if (!item.folder) return err('That link is a file. Paste the link of the folder it is in.', 'NOT_A_FOLDER', 400);
      return json({ entries: [{ ref: `folder:-:${item.id}`, name: item.name, kind: 'folder', selectable: true }], shareEmail: sa.email });
    }
    if (ref === 'root') return json({ entries: await sharedFolders(token), shareEmail: sa.email });
    if (!/^folder:-:[A-Za-z0-9_-]+$/.test(ref)) return err('Pick a folder shared with ShareOut', 'VALIDATION_ERROR', 400);
    return json({ ...(await googleDrive.browse(token, ref)), shareEmail: sa.email });
  });
}

async function dailyCapReached(env: Env, workspaceId: string): Promise<boolean> {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM file_import_sources WHERE workspace_id = ? AND daily_sync_enabled = 1')
    .bind(workspaceId).first<{ n: number }>();
  return (n?.n ?? 0) >= MAX_DAILY_SOURCES_PER_WORKSPACE;
}

/** Where a new source reads from: the member's connection, or the workspace's service account. */
interface SourceAccess { auth: 'oauth' | 'service_account'; connectionId: string | null; provider: FileImportProvider; driveId: string | null; folderId: string }

async function oauthAccess(env: Env, workspaceId: string, userId: string, provider: string, ref: string, providers: FileImportProvider[]): Promise<SourceAccess | Response> {
  const conn = await connectionFor(env, workspaceId, userId, provider, providers);
  if (conn instanceof Response) return conn;
  const api = providerApi(conn.provider);
  let loc: Awaited<ReturnType<typeof api.locate>> = null;
  const located = await withProvider(env, conn, async (token) => {
    loc = await api.locate(token, ref);
    return json({});
  });
  if (!located.ok) return located;
  if (!loc) return err('Pick a folder to import', 'VALIDATION_ERROR', 400);
  const { driveId, folderId } = loc as { driveId: string | null; folderId: string };
  return { auth: 'oauth', connectionId: conn.id, provider: conn.provider, driveId, folderId };
}

/** Sharing: the folder must be visible to this workspace's own account right now. */
async function sharedAccess(env: Env, workspaceId: string, ref: string): Promise<SourceAccess | Response> {
  const m = /^folder:-:([A-Za-z0-9_-]+)$/.exec(ref);
  if (!m) return err('Pick a folder shared with ShareOut', 'VALIDATION_ERROR', 400);
  let folderId = '';
  const seen = await withShare(env, workspaceId, async (token) => {
    const item = await sharedItem(token, m[1]);
    if (!item.folder) return err('Pick a folder, not a file', 'NOT_A_FOLDER', 400);
    folderId = item.id;
    return json({});
  });
  if (!seen.ok) return seen;
  return { auth: 'service_account', connectionId: null, provider: 'google_drive', driveId: null, folderId };
}

async function createSource(ctx: FetchContext, workspaceId: string, userId: string, providers: FileImportProvider[], share: boolean): Promise<Response> {
  const { env, request } = ctx;
  const b = (await request.json().catch(() => ({}))) as { provider?: unknown; ref?: unknown; name?: unknown; targetFolderId?: unknown; convert?: unknown; dailySync?: unknown; access?: unknown };
  if (typeof b.ref !== 'string' || !b.ref) return err('ref is required', 'VALIDATION_ERROR', 400);
  const provider = String(b.provider || '');
  const viaShare = b.access === 'share';
  if (viaShare && (provider !== 'google_drive' || !share)) return err('Google Drive sharing isn\u2019t set up on this instance', 'PROVIDER_NOT_CONFIGURED', 404);
  const target = typeof b.targetFolderId === 'string' && b.targetFolderId ? b.targetFolderId : null;
  if (target) {
    const f = await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND workspace_id = ?').bind(target, workspaceId).first();
    if (!f) return err('Target folder not found', 'FOLDER_NOT_FOUND', 404);
  }
  if (b.dailySync === true && (await dailyCapReached(env, workspaceId))) {
    return err(`At most ${MAX_DAILY_SOURCES_PER_WORKSPACE} folders can sync daily in one workspace`, 'DAILY_SYNC_LIMIT', 409);
  }
  const access = viaShare
    ? await sharedAccess(env, workspaceId, b.ref.slice(0, 600))
    : await oauthAccess(env, workspaceId, userId, provider, b.ref, providers);
  if (access instanceof Response) return access;
  const { driveId, folderId } = access;
  const name = (typeof b.name === 'string' && b.name.trim() ? b.name.trim() : 'Imported files').slice(0, 200);
  const id = generateId('fis');
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO file_import_sources (id, workspace_id, connection_id, auth, provider, remote_drive_id, remote_folder_id, remote_name, target_folder_id,
      convert_enabled, daily_sync_enabled, next_sync_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, workspaceId, access.connectionId, access.auth, access.provider, driveId, folderId, name, target, b.convert === false ? 0 : 1,
    b.dailySync === true ? 1 : 0, b.dailySync === true ? new Date(Date.now() + 24 * 3600_000).toISOString() : null, userId, now, now).run();
  const source = (await getSource(env, workspaceId, id))!;
  const r = await createRun(env, source, 'manual', userId);
  if ('conflict' in r) return err('Already syncing', 'RUN_IN_PROGRESS', 409);
  await launchRun(env, ctx.executionCtx, r.runId);
  return json({ source: await sourceView(env, (await getSource(env, workspaceId, id))!, userId), run: runView((await getRun(env, r.runId))!) }, 201);
}

async function sourceView(env: Env, s: SourceRow, userId: string) {
  const run = s.last_run_id ? await getRun(env, s.last_run_id) : null;
  const target = s.target_folder_id
    ? await env.DB.prepare('SELECT name FROM folders WHERE id = ?').bind(s.target_folder_id).first<{ name: string }>()
    : null;
  return {
    id: s.id, provider: s.provider, remoteName: s.remote_name,
    targetFolderId: s.target_folder_id, targetFolderName: target?.name ?? null,
    convert: !!s.convert_enabled, dailySync: !!s.daily_sync_enabled, nextSyncAt: s.next_sync_at,
    connected: !!s.connection_id || s.auth === 'service_account', mine: s.created_by === userId, createdAt: s.created_at,
    access: s.auth === 'service_account' ? 'share' as const : 'oauth' as const,
    canSwitchToShare: s.auth !== 'service_account' && s.provider === 'google_drive' && serviceAccountConfigured(env),
    lastRun: run ? runView(run as RunRow) : null,
  };
}

async function overview(env: Env, workspaceId: string, userId: string, providers: FileImportProvider[]) {
  const conns = await listConnections(env, workspaceId, userId);
  const sources = (await env.DB.prepare('SELECT * FROM file_import_sources WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(workspaceId).all<SourceRow>()).results || [];
  // Google Drive by sharing, when configured: the folder-import UI offers it instead of the OAuth consent.
  const sa = serviceAccountConfigured(env) ? await serviceAccountFor(env, workspaceId) : null;
  return {
    providers: providers.map((p) => {
      const c = conns.find((x) => x.provider === p);
      return { id: p, connected: !!c, accountEmail: c?.accountEmail ?? null };
    }),
    share: serviceAccountConfigured(env) ? { provider: 'google_drive' as const, shareEmail: sa?.status === 'ready' ? sa.email : null } : null,
    sources: await Promise.all(sources.map((s) => sourceView(env, s, userId))),
  };
}

// ---- OAuth callback --------------------------------------------------------------

function callbackPage(ok: boolean, provider: string, message: string): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ok ? 'Connected' : 'Connection failed'} - ShareOut</title><style>${standalonePageStyles}</style></head>
<body><div class="card"><div class="icon ${ok ? 'success' : 'error'}">${ok ? '✓' : '✕'}</div>
<h1>${ok ? 'Connected' : 'Connection failed'}</h1><p>${escapeHtml(message)}</p>
<p class="close-hint">You can close this window.</p></div>
<script>if (window.opener) { window.opener.postMessage({ type: 'shareout:file-import:connected', ok: ${ok ? 'true' : 'false'}, provider: ${JSON.stringify(isFileImportProvider(provider) ? provider : '')} }, '*'); window.close(); }</script>
</body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

async function handleCallback(ctx: FetchContext, provider: string): Promise<Response> {
  const { env, url } = ctx;
  const rawState = url.searchParams.get('state') || '';
  const state = await verifyState(env, rawState);
  // The sheet sync's consent returns here too (same redirect URI), told apart by its signed state.
  if (state?.p === DRIVE_FILE_CONSENT && provider === 'google_drive') return handleSheetPick(ctx, state, rawState);
  if (!isFileImportProvider(provider) || !providerConfig(env, provider)) return callbackPage(false, provider, 'This provider is not set up on this instance.');
  if (url.searchParams.get('error')) return callbackPage(false, provider, 'Access was not granted.');
  const code = url.searchParams.get('code');
  if (!code || !state || state.p !== provider) return callbackPage(false, provider, 'This link expired. Start the connection again.');
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user) || user.id !== state.u) return callbackPage(false, provider, 'Sign in to ShareOut as the person who started this connection.');
  if (!(await canImport(env, state.ws, user.id))) return callbackPage(false, provider, 'You can no longer import into this workspace.');
  try {
    const tokens = await exchangeCode(env, provider, code, rawState);
    await saveConnection(env, state.ws, user.id, provider, tokens, await accountEmail(provider, tokens.accessToken));
  } catch (e) {
    return callbackPage(false, provider, e instanceof OAuthGrantError ? 'The provider refused the connection. Try again.' : 'Something went wrong while connecting.');
  }
  return callbackPage(true, provider, 'Your drive is connected. Go back to ShareOut to pick a folder.');
}

/** The sheet sync's consent page: tells the opening ShareOut window (that origin only) what was picked. */
function sheetPickPage(ok: boolean, message: string, origin: string | undefined, file?: { id: string; name: string }): Response {
  let target = '';
  try { if (origin && new URL(origin).origin === origin) target = origin; } catch { /* no opener to tell */ }
  // A Drive file name is the user's text: keep it from closing the script tag.
  const msg = JSON.stringify({ type: 'shareout:drive-sheet:picked', ok, file: file ?? null, error: ok ? null : message }).replace(/</g, '\\u003c');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ok ? 'Spreadsheet picked' : 'Nothing picked'} - ShareOut</title><style>${standalonePageStyles}</style></head>
<body><div class="card"><div class="icon ${ok ? 'success' : 'error'}">${ok ? '✓' : '✕'}</div>
<h1>${ok ? 'Spreadsheet picked' : 'Nothing picked'}</h1><p>${escapeHtml(message)}</p>
<p class="close-hint">You can close this window.</p></div>
${target ? `<script>if (window.opener) { window.opener.postMessage(${msg}, ${JSON.stringify(target)}); window.close(); }</script>` : ''}
</body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

/** Consent + Picker came back: store the drive.file consent, check the picked file is a spreadsheet. */
async function handleSheetPick(ctx: FetchContext, state: OAuthState, rawState: string): Promise<Response> {
  const { env, url } = ctx;
  const done = (ok: boolean, message: string, file?: { id: string; name: string }) => sheetPickPage(ok, message, state.o, file);
  if (!providerConfig(env, DRIVE_FILE_CONSENT)) return done(false, 'Google Drive is not set up on this instance.');
  if (url.searchParams.get('error')) return done(false, 'No spreadsheet was picked.');
  const code = url.searchParams.get('code');
  if (!code) return done(false, 'This link expired. Start again.');
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user) || user.id !== state.u) return done(false, 'Sign in to ShareOut as the person who started this.');
  if (!(await canImport(env, state.ws, user.id))) return done(false, 'You can no longer import into this workspace.');
  const fileId = (url.searchParams.get('picked_file_ids') || '').split(',')[0].trim();
  if (!DRIVE_FILE_ID.test(fileId)) return done(false, 'No spreadsheet was picked. Try again.');
  let entry: RemoteEntry;
  try {
    const tokens = await exchangeCode(env, DRIVE_FILE_CONSENT, code, rawState);
    await saveConnection(env, state.ws, user.id, DRIVE_FILE_CONSENT, tokens, await accountEmail(DRIVE_FILE_CONSENT, tokens.accessToken));
    entry = await getDriveFile(tokens.accessToken, fileId);
  } catch (e) {
    if (e instanceof OAuthGrantError) return done(false, 'Google refused the connection. Try again.');
    if (e instanceof ProviderError || e instanceof AuthExpiredError) return done(false, 'Google Drive could not read that file. Pick it again.');
    return done(false, 'Something went wrong while connecting.');
  }
  if (!isSpreadsheet(entry)) return done(false, `"${entry.name}" is not a spreadsheet (Excel, Google Sheets, OpenDocument or CSV).`);
  return done(true, 'Go back to ShareOut to finish setting up the sync.', { id: entry.id, name: entry.name });
}
