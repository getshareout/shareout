/**
 * The import run, as a sequence of small idempotent steps:
 *
 *   start → walk × N → import × N → finish
 *
 * Every step reads its state from D1 and writes its progress back before returning,
 * so a step that is retried (Workflow retry, worker eviction) redoes at most its own
 * batch. The walk records each remote item in file_import_items with this run's id;
 * the import fetches only files whose remote version differs from the one last
 * imported. A re-run therefore costs one listing per folder plus the changed files.
 *
 * The same steps run inside FileImportWorkflow (durable, per-step retries) or inline
 * when the instance has no FILE_IMPORT binding.
 */
import type { Env } from '../types';
import { DEFAULT_LIMITS, FOLDERS_PER_STEP, type RemoteLocation, type WalkLimits } from './types';
import { getRun, getSource, stopRun } from './runs';
import { getConnection } from './connections';
import { AuthExpiredError, RateLimitedError } from './http';
import { withToken, type Active } from './context';
import { providerApi } from './providers';
import { canImport, ensureMirrorFolder } from './mirror';
import { importBatch } from './import-file';

export type StepRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/**
 * The run, if it should keep going. Stops it — and returns null — when its source is
 * gone, its connection was revoked, or the person who connected may no longer import.
 */
export async function loadActive(env: Env, runId: string, limits: WalkLimits): Promise<Active | null> {
  const run = await getRun(env, runId);
  if (!run || !['queued', 'walking', 'importing'].includes(run.status)) return null;
  const source = await getSource(env, run.workspace_id, run.source_id);
  if (!source) { await stopRun(env, runId, 'stopped', 'SOURCE_DELETED', 'This import was removed.'); return null; }
  const conn = source.connection_id ? await getConnection(env, source.connection_id) : null;
  if (!conn || conn.workspace_id !== source.workspace_id) {
    await stopRun(env, runId, 'stopped', 'CONNECTION_REVOKED', 'The drive was disconnected. Reconnect it and sync again.');
    return null;
  }
  if (!(await canImport(env, source.workspace_id, conn.user_id))) {
    await stopRun(env, runId, 'stopped', 'NOT_ALLOWED', 'The person who connected this drive can no longer import into this workspace.');
    return null;
  }
  return { env, run, source, conn, api: providerApi(source.provider), limits };
}

async function touch(env: Env, runId: string, status?: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE file_import_runs SET ${status ? 'status = ?, ' : ''}updated_at = ? WHERE id = ? AND status IN ('queued', 'walking', 'importing')`,
  ).bind(...(status ? [status] : []), new Date().toISOString(), runId).run();
}

/** Errors that end the run cleanly instead of failing it. */
async function guard<T extends { done: boolean }>(env: Env, runId: string, fn: () => Promise<T>): Promise<T | { done: true }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthExpiredError) {
      await stopRun(env, runId, 'stopped', 'CONNECTION_REVOKED', e.message);
      return { done: true };
    }
    throw e;
  }
}

// ---- start -----------------------------------------------------------------------

export async function startStep(env: Env, runId: string, limits: WalkLimits = DEFAULT_LIMITS): Promise<{ done: boolean }> {
  const a = await loadActive(env, runId, limits);
  if (!a) return { done: true };
  const { source } = a;
  const root = await env.DB.prepare('SELECT folder_id FROM file_import_items WHERE source_id = ? AND remote_id = ?')
    .bind(source.id, source.remote_folder_id).first<{ folder_id: string | null }>();
  const folderId = await ensureMirrorFolder(env, source.workspace_id, a.conn.user_id, source.target_folder_id, source.remote_name, root?.folder_id ?? null);
  await env.DB.prepare(`
    INSERT INTO file_import_items (source_id, remote_id, kind, name, path, depth, seen_run_id, folder_id, status)
    VALUES (?, ?, 'folder', ?, ?, 0, ?, ?, 'imported')
    ON CONFLICT(source_id, remote_id) DO UPDATE SET seen_run_id = excluded.seen_run_id, folder_id = excluded.folder_id,
      name = excluded.name, path = excluded.path, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(source.id, source.remote_folder_id, source.remote_name, source.remote_name, runId, folderId).run();
  await touch(env, runId, 'walking');
  return { done: false };
}

// ---- walk ------------------------------------------------------------------------

interface FolderItem { remote_id: string; parent_remote_id: string | null; name: string; path: string; depth: number; folder_id: string | null }

async function seenCounts(env: Env, sourceId: string, runId: string): Promise<{ folders: number; files: number }> {
  const rows = (await env.DB.prepare('SELECT kind, COUNT(*) AS n FROM file_import_items WHERE source_id = ? AND seen_run_id = ? GROUP BY kind')
    .bind(sourceId, runId).all<{ kind: string; n: number }>()).results || [];
  return { folders: rows.find((r) => r.kind === 'folder')?.n ?? 0, files: rows.find((r) => r.kind === 'file')?.n ?? 0 };
}

const noted = new Set<string>();
async function noteLimit(env: Env, runId: string, message: string): Promise<void> {
  const key = `${runId}:${message}`;
  if (noted.has(key)) return;
  if (noted.size > 1000) noted.clear();
  noted.add(key);
  await env.DB.prepare("UPDATE file_import_runs SET stop_code = 'WALK_LIMIT', stop_message = ? WHERE id = ? AND stop_code IS NULL")
    .bind(message, runId).run();
}

/** List up to FOLDERS_PER_STEP folders this run has seen but not listed yet. */
export async function walkStep(env: Env, runId: string, limits: WalkLimits = DEFAULT_LIMITS): Promise<{ done: boolean }> {
  return guard(env, runId, async () => {
    const a = await loadActive(env, runId, limits);
    if (!a) return { done: true };
    const { source } = a;
    const folders = (await env.DB.prepare(`
      SELECT remote_id, parent_remote_id, name, path, depth, folder_id FROM file_import_items
      WHERE source_id = ? AND seen_run_id = ? AND kind = 'folder' AND IFNULL(listed_run_id, '') != ? AND depth <= ?
      ORDER BY depth, path LIMIT ?
    `).bind(source.id, runId, runId, limits.maxDepth, FOLDERS_PER_STEP).all<FolderItem>()).results || [];
    if (!folders.length) {
      await touch(env, runId, 'importing');
      return { done: true };
    }
    const counts = await seenCounts(env, source.id, runId);
    for (const f of folders) {
      let folderId = f.folder_id;
      if (f.depth > 0) {
        const parent = await env.DB.prepare('SELECT folder_id FROM file_import_items WHERE source_id = ? AND remote_id = ?')
          .bind(source.id, f.parent_remote_id).first<{ folder_id: string | null }>();
        folderId = await ensureMirrorFolder(env, source.workspace_id, a.conn.user_id, parent?.folder_id ?? null, f.name, f.folder_id);
      }
      const loc: RemoteLocation = { driveId: source.remote_drive_id, folderId: f.remote_id };
      let page: string | undefined;
      do {
        const listing = await withToken(a, (t) => a.api.listChildren(t, loc, page));
        const stmts: D1PreparedStatement[] = [];
        for (const e of listing.entries) {
          const depth = f.depth + 1;
          if (e.kind === 'folder' && counts.folders >= limits.maxFolders) { await noteLimit(env, runId, `Stopped at ${limits.maxFolders} folders; pick a smaller folder for the rest.`); continue; }
          if (e.kind === 'file' && counts.files >= limits.maxFiles) { await noteLimit(env, runId, `Stopped at ${limits.maxFiles} files; pick a smaller folder for the rest.`); continue; }
          const tooDeep = e.kind === 'folder' && depth > limits.maxDepth;
          if (tooDeep) await noteLimit(env, runId, `Folders more than ${limits.maxDepth} levels deep were not imported.`);
          if (e.kind === 'folder') counts.folders++; else counts.files++;
          stmts.push(env.DB.prepare(`
            INSERT INTO file_import_items (source_id, remote_id, kind, parent_remote_id, name, path, depth, remote_mime, remote_size, remote_version, seen_run_id, status, attempt_run_id, error_code, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, remote_id) DO UPDATE SET kind = excluded.kind, parent_remote_id = excluded.parent_remote_id,
              name = excluded.name, path = excluded.path, depth = excluded.depth, remote_mime = excluded.remote_mime,
              remote_size = excluded.remote_size, remote_version = excluded.remote_version, seen_run_id = excluded.seen_run_id,
              status = CASE WHEN excluded.status = 'skipped' THEN 'skipped' ELSE file_import_items.status END,
              attempt_run_id = COALESCE(excluded.attempt_run_id, file_import_items.attempt_run_id),
              error_code = CASE WHEN excluded.status = 'skipped' THEN excluded.error_code ELSE file_import_items.error_code END,
              error_message = CASE WHEN excluded.status = 'skipped' THEN excluded.error_message ELSE file_import_items.error_message END,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          `).bind(
            source.id, e.id, e.kind, f.remote_id, e.name.slice(0, 500), `${f.path}/${e.name}`.slice(0, 2000), depth,
            e.mime ?? null, e.size ?? null, e.version ?? null, runId,
            tooDeep ? 'skipped' : 'pending', tooDeep ? runId : null, tooDeep ? 'TOO_DEEP' : null,
            tooDeep ? `More than ${limits.maxDepth} folder levels deep.` : null,
          ));
        }
        for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
        page = listing.next;
      } while (page);
      await env.DB.prepare("UPDATE file_import_items SET listed_run_id = ?, folder_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE source_id = ? AND remote_id = ?")
        .bind(runId, folderId, source.id, f.remote_id).run();
    }
    await env.DB.prepare("UPDATE file_import_runs SET found_count = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .bind(counts.files, runId).run();
    return { done: false };
  });
}

// ---- import + finish -------------------------------------------------------------

export async function importStep(env: Env, runId: string, limits: WalkLimits = DEFAULT_LIMITS): Promise<{ done: boolean }> {
  return guard(env, runId, async () => {
    const a = await loadActive(env, runId, limits);
    if (!a) return { done: true };
    return importBatch(a);
  });
}

export async function finishStep(env: Env, runId: string): Promise<void> {
  const run = await getRun(env, runId);
  if (!run) return;
  const now = new Date().toISOString();
  await stopRun(env, runId, 'done', null, null);
  await env.DB.prepare(`
    UPDATE file_import_sources SET next_sync_at = CASE WHEN daily_sync_enabled = 1 THEN ? ELSE next_sync_at END, updated_at = ?
    WHERE id = ?
  `).bind(new Date(Date.now() + 24 * 3600_000).toISOString(), now, run.source_id).run();
}

export async function markFailed(env: Env, runId: string, err: unknown): Promise<void> {
  const rate = err instanceof RateLimitedError;
  await stopRun(env, runId, 'failed', rate ? 'RATE_LIMITED' : 'FAILED',
    rate ? 'The drive kept rate limiting this import. Sync again in a few minutes; finished files are kept.'
      : `The import stopped: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}. Sync again to continue.`);
}

/** Drive a run to the end. `exec` makes each step durable (Workflow) or just runs it. */
export async function runImport(env: Env, runId: string, exec: StepRunner = (_n, fn) => fn(), limits: WalkLimits = DEFAULT_LIMITS): Promise<void> {
  try {
    if ((await exec('start', () => startStep(env, runId, limits))).done) return;
    for (let i = 0; ; i++) if ((await exec(`walk ${i}`, () => walkStep(env, runId, limits))).done) break;
    for (let i = 0; ; i++) if ((await exec(`import ${i}`, () => importStep(env, runId, limits))).done) break;
    await exec('finish', () => finishStep(env, runId).then(() => ({ done: true })));
  } catch (err) {
    await exec('mark failed', () => markFailed(env, runId, err).then(() => ({ done: true })));
    if (!(err instanceof RateLimitedError)) throw err;
  }
}
