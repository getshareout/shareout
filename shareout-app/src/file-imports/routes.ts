/**
 * Folder import API. Everything is workspace-scoped and limited to people who may
 * import (canImport: owners, admins, and members while members may create folders).
 * Tokens never leave the server; responses carry only connection summaries.
 *
 *   GET    /v1/workspaces/{ws}/file-imports                       providers, my connections, sources
 *   GET    /v1/workspaces/{ws}/file-imports/connect/{provider}    → 302 to the provider's consent screen
 *   GET    /v1/file-imports/oauth/{provider}/callback             consent lands here (fixed redirect URI)
 *   DELETE /v1/workspaces/{ws}/file-imports/connections/{provider} disconnect (stops every sync through it)
 *   GET    /v1/workspaces/{ws}/file-imports/browse/{provider}?ref=&q=  server-side folder browser
 *   POST   /v1/workspaces/{ws}/file-imports/sources               { provider, ref, name, targetFolderId?, convert?, dailySync? }
 *   PATCH  /v1/workspaces/{ws}/file-imports/sources/{id}          { dailySync?, convert? }
 *   DELETE /v1/workspaces/{ws}/file-imports/sources/{id}          stop syncing (imported files stay)
 *   POST   /v1/workspaces/{ws}/file-imports/sources/{id}/sync     sync again
 *   GET    /v1/workspaces/{ws}/file-imports/runs/{runId}          progress + per-file errors
 */
import type { FetchContext } from '../router/context';
import type { Env } from '../types';
import { isAuthUser, requireTokenOrSession } from '../router/helpers/auth-guard';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { jsonWithApiErrors } from '../http/api-error';
import { escapeHtml } from '../html/utils';
import { standalonePageStyles } from '../design-system/standalone-page';
import { isFileImportProvider, MAX_DAILY_SOURCES_PER_WORKSPACE, type FileImportProvider } from './types';
import { accountEmail, authorizationUrl, configuredProviders, exchangeCode, OAuthGrantError, providerConfig, verifyState } from './oauth';
import { accessTokenFor, deleteConnection, findConnection, listConnections, saveConnection, type ConnectionRow } from './connections';
import { providerApi } from './providers';
import { canImport } from './mirror';
import { createRun, getRun, getSource, readRun, runView, type RunRow, type SourceRow } from './runs';
import { launchRun } from './launch';
import { AuthExpiredError, ProviderError, RateLimitedError } from './http';
import { generateId } from '../crypto-utils';

const json = (data: unknown, status = 200) => jsonWithApiErrors(data, status);
const err = (error: string, code: string, status: number, extra: Record<string, unknown> = {}) => json({ error, code, ...extra }, status);

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

  if (sub === '' && method === 'GET') return json(await overview(env, workspaceId, user.id, providers));

  let m = sub.match(/^connect\/([a-z_]+)$/);
  if (m && method === 'GET') {
    if (!isFileImportProvider(m[1]) || !providers.includes(m[1])) return err('This provider is not set up on this instance', 'PROVIDER_NOT_CONFIGURED', 404);
    const url = await authorizationUrl(env, m[1], workspaceId, user.id);
    return url ? new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } }) : err('This provider is not set up on this instance', 'PROVIDER_NOT_CONFIGURED', 404);
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
  if (m && method === 'GET') {
    const conn = await connectionFor(env, workspaceId, user.id, m[1], providers);
    if (conn instanceof Response) return conn;
    const ref = ctx.url.searchParams.get('ref') || 'root';
    const q = ctx.url.searchParams.get('q') || undefined;
    return withProvider(env, conn, async (token) => json(await providerApi(conn.provider).browse(token, ref.slice(0, 600), q)));
  }

  if (sub === 'sources' && method === 'POST') return createSource(ctx, workspaceId, user.id, providers);

  m = sub.match(/^sources\/([^/]+)(\/sync)?$/);
  if (m) {
    const source = await getSource(env, workspaceId, m[1]);
    if (!source) return err('Import not found', 'NOT_FOUND', 404);
    if (m[2] && method === 'POST') {
      if (!source.connection_id) return err('Reconnect the drive to sync this folder again', 'CONNECTION_REVOKED', 409);
      const r = await createRun(env, source, 'resync', user.id);
      if ('conflict' in r) return err('This folder is already syncing', 'RUN_IN_PROGRESS', 409, { run: runView(r.conflict) });
      await launchRun(env, ctx.executionCtx, r.runId);
      return json({ run: runView((await getRun(env, r.runId))!) }, 202);
    }
    if (!m[2] && method === 'PATCH') {
      const b = (await request.json().catch(() => ({}))) as { dailySync?: unknown; convert?: unknown };
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (typeof b.dailySync === 'boolean') {
        if (b.dailySync && !source.daily_sync_enabled) {
          if (!source.connection_id) return err('Reconnect the drive first', 'CONNECTION_REVOKED', 409);
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

async function connectionFor(env: Env, workspaceId: string, userId: string, provider: string, providers: FileImportProvider[]): Promise<ConnectionRow | Response> {
  if (!isFileImportProvider(provider) || !providers.includes(provider)) return err('This provider is not set up on this instance', 'PROVIDER_NOT_CONFIGURED', 404);
  const conn = await findConnection(env, workspaceId, userId, provider);
  return conn ?? err('Connect this drive first', 'NOT_CONNECTED', 409);
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

async function dailyCapReached(env: Env, workspaceId: string): Promise<boolean> {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM file_import_sources WHERE workspace_id = ? AND daily_sync_enabled = 1')
    .bind(workspaceId).first<{ n: number }>();
  return (n?.n ?? 0) >= MAX_DAILY_SOURCES_PER_WORKSPACE;
}

async function createSource(ctx: FetchContext, workspaceId: string, userId: string, providers: FileImportProvider[]): Promise<Response> {
  const { env, request } = ctx;
  const b = (await request.json().catch(() => ({}))) as { provider?: unknown; ref?: unknown; name?: unknown; targetFolderId?: unknown; convert?: unknown; dailySync?: unknown };
  if (typeof b.ref !== 'string' || !b.ref) return err('ref is required', 'VALIDATION_ERROR', 400);
  const conn = await connectionFor(env, workspaceId, userId, String(b.provider || ''), providers);
  if (conn instanceof Response) return conn;
  const target = typeof b.targetFolderId === 'string' && b.targetFolderId ? b.targetFolderId : null;
  if (target) {
    const f = await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND workspace_id = ?').bind(target, workspaceId).first();
    if (!f) return err('Target folder not found', 'FOLDER_NOT_FOUND', 404);
  }
  if (b.dailySync === true && (await dailyCapReached(env, workspaceId))) {
    return err(`At most ${MAX_DAILY_SOURCES_PER_WORKSPACE} folders can sync daily in one workspace`, 'DAILY_SYNC_LIMIT', 409);
  }
  const api = providerApi(conn.provider);
  let loc: Awaited<ReturnType<typeof api.locate>> = null;
  const located = await withProvider(env, conn, async (token) => {
    loc = await api.locate(token, b.ref as string);
    return json({});
  });
  if (!located.ok) return located;
  if (!loc) return err('Pick a folder to import', 'VALIDATION_ERROR', 400);
  const { driveId, folderId } = loc as { driveId: string | null; folderId: string };
  const name = (typeof b.name === 'string' && b.name.trim() ? b.name.trim() : 'Imported files').slice(0, 200);
  const id = generateId('fis');
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO file_import_sources (id, workspace_id, connection_id, provider, remote_drive_id, remote_folder_id, remote_name, target_folder_id,
      convert_enabled, daily_sync_enabled, next_sync_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, workspaceId, conn.id, conn.provider, driveId, folderId, name, target, b.convert === false ? 0 : 1,
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
    connected: !!s.connection_id, mine: s.created_by === userId, createdAt: s.created_at,
    lastRun: run ? runView(run as RunRow) : null,
  };
}

async function overview(env: Env, workspaceId: string, userId: string, providers: FileImportProvider[]) {
  const conns = await listConnections(env, workspaceId, userId);
  const sources = (await env.DB.prepare('SELECT * FROM file_import_sources WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(workspaceId).all<SourceRow>()).results || [];
  return {
    providers: providers.map((p) => {
      const c = conns.find((x) => x.provider === p);
      return { id: p, connected: !!c, accountEmail: c?.accountEmail ?? null };
    }),
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
  if (!isFileImportProvider(provider) || !providerConfig(env, provider)) return callbackPage(false, provider, 'This provider is not set up on this instance.');
  if (url.searchParams.get('error')) return callbackPage(false, provider, 'Access was not granted.');
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state') || '';
  const state = await verifyState(env, rawState);
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
