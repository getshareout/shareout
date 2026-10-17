/**
 * Sources and runs: creating a run (one active per source), launching it durably, and
 * reading its progress back for the UI.
 */
import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { ACTIVE_STATUSES, STALE_RUN_MS, type FileImportProvider, type RunStatus, type RunTrigger } from './types';

export interface SourceRow {
  id: string;
  workspace_id: string;
  connection_id: string | null;
  provider: FileImportProvider;
  remote_drive_id: string | null;
  remote_folder_id: string;
  remote_name: string;
  target_folder_id: string | null;
  convert_enabled: number;
  daily_sync_enabled: number;
  next_sync_at: string | null;
  last_run_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RunRow {
  id: string;
  source_id: string;
  workspace_id: string;
  run_trigger: RunTrigger;
  status: RunStatus;
  found_count: number;
  imported_count: number;
  converted_count: number;
  skipped_count: number;
  unchanged_count: number;
  failed_count: number;
  stop_code: string | null;
  stop_message: string | null;
  started_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export async function getSource(env: Env, workspaceId: string, id: string): Promise<SourceRow | null> {
  return env.DB.prepare('SELECT * FROM file_import_sources WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).first<SourceRow>();
}

export async function getRun(env: Env, runId: string): Promise<RunRow | null> {
  return env.DB.prepare('SELECT * FROM file_import_runs WHERE id = ?').bind(runId).first<RunRow>();
}

export function isActive(run: RunRow, now = Date.now()): boolean {
  return ACTIVE_STATUSES.includes(run.status) && Date.parse(run.updated_at) > now - STALE_RUN_MS;
}

/** Start a run unless one is already going. Returns the running one on conflict. */
export async function createRun(
  env: Env, source: SourceRow, trigger: RunTrigger, userId: string | null,
): Promise<{ runId: string } | { conflict: RunRow }> {
  if (source.last_run_id) {
    const last = await getRun(env, source.last_run_id);
    if (last && isActive(last)) return { conflict: last };
    // A dead run (worker evicted mid-way) is closed so its counts stop looking live.
    if (last && ACTIVE_STATUSES.includes(last.status)) {
      await stopRun(env, last.id, 'failed', 'STALLED', 'This run stopped responding. Sync again to continue where it left off.');
    }
  }
  const runId = generateId('fir');
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO file_import_runs (id, source_id, workspace_id, run_trigger, status, started_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(runId, source.id, source.workspace_id, trigger, 'queued', userId, now, now),
    env.DB.prepare('UPDATE file_import_sources SET last_run_id = ?, updated_at = ? WHERE id = ?').bind(runId, now, source.id),
  ]);
  return { runId };
}

/** Close a run. Only an active run changes, so a late step cannot reopen a stopped one. */
export async function stopRun(env: Env, runId: string, status: 'stopped' | 'failed' | 'done', code: string | null, message: string | null): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE file_import_runs SET status = ?, stop_code = COALESCE(?, stop_code), stop_message = COALESCE(?, stop_message),
      finished_at = ?, updated_at = ?
    WHERE id = ? AND status IN ('queued', 'walking', 'importing')
  `).bind(status, code, message, now, now, runId).run();
}

export interface RunError {
  path: string;
  status: string;
  code: string;
  message: string;
}

export interface RunView {
  id: string;
  sourceId: string;
  status: RunStatus;
  trigger: RunTrigger;
  counts: { found: number; imported: number; converted: number; skipped: number; unchanged: number; failed: number };
  stopCode: string | null;
  stopMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
  errors: RunError[];
}

const ERRORS_LIMIT = 200;

export function runView(run: RunRow, errors: RunError[] = []): RunView {
  return {
    id: run.id, sourceId: run.source_id, status: run.status, trigger: run.run_trigger,
    counts: {
      found: run.found_count, imported: run.imported_count, converted: run.converted_count,
      skipped: run.skipped_count, unchanged: run.unchanged_count, failed: run.failed_count,
    },
    stopCode: run.stop_code, stopMessage: run.stop_message, createdAt: run.created_at, finishedAt: run.finished_at,
    errors,
  };
}

/** A run with its per-file problems (failed, skipped, or imported with a warning). */
export async function readRun(env: Env, workspaceId: string, runId: string): Promise<RunView | null> {
  const run = await env.DB.prepare('SELECT * FROM file_import_runs WHERE id = ? AND workspace_id = ?').bind(runId, workspaceId).first<RunRow>();
  if (!run) return null;
  const rows = await env.DB.prepare(`
    SELECT path, status, error_code, error_message FROM file_import_items
    WHERE source_id = ? AND attempt_run_id = ? AND error_code IS NOT NULL
    ORDER BY status = 'failed' DESC, path LIMIT ?
  `).bind(run.source_id, run.id, ERRORS_LIMIT).all<{ path: string; status: string; error_code: string; error_message: string | null }>();
  return runView(run, (rows.results || []).map((r) => ({ path: r.path, status: r.status, code: r.error_code, message: r.error_message || '' })));
}
