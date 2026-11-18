import type { Destination, DeliveryStep } from '../types';
import type { PublicSheetSyncConfig } from '../../scheduling/jobs/types';
import { PublicLinkError, fetchPublicSheet, parseShareLink } from '../../data/files/public-sheet-link';
import { SheetRowsError, sheetRows } from '../../data/files/sheet-rows';
import { writeDatasetRows } from '../../data/datasets/handler';
import { sha256 } from '../../crypto-utils';

// A spreadsheet shared as "Anyone with the link can view" → one of the artifact's datasets,
// on the job's own schedule — no Google sign-in. The private path is drive_file_sync (the
// file picked with Google). A public link has no revision to compare, so every run
// downloads the file, and the write is skipped when the tab's rows are unchanged: an hourly
// schedule does not pile up dataset versions while nothing moves.

const DATASET_NAME = /^[a-zA-Z0-9_.-]{1,64}$/;

/** Same tab + same rows → same key. Dataset metadata is readable by the page's viewers, so
 *  it carries neither the link nor the file id (the link alone grants read access). */
export async function publicSheetKey(sheet: string, rows: unknown[]): Promise<string> {
  const hex = await sha256(new TextEncoder().encode(`${sheet}\n${JSON.stringify(rows)}`).buffer as ArrayBuffer);
  return hex.slice(0, 32);
}

async function workspaceOf(env: Parameters<Destination['validate']>[0], artifactId: string): Promise<string | null> {
  const art = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  return art?.workspace_id ?? null;
}

export const publicSheetSyncDestination: Destination<PublicSheetSyncConfig> = {
  kind: 'public_sheet_sync',

  async validate(env, ctx, config) {
    if (typeof config?.link !== 'string') return 'public_sheet_sync requires the spreadsheet’s share link';
    try { parseShareLink(config.link); } catch (e) { return e instanceof PublicLinkError ? e.message : 'public_sheet_sync requires a Google share link'; }
    if (typeof config.dataset !== 'string' || !DATASET_NAME.test(config.dataset)) {
      return 'public_sheet_sync requires a dataset name (letters, digits, _ . -, up to 64)';
    }
    if (config.sheet !== undefined && (typeof config.sheet !== 'string' || config.sheet.length > 100)) return 'sheet must be a tab name (up to 100 characters)';
    if (config.fileName !== undefined && (typeof config.fileName !== 'string' || config.fileName.length > 200)) return 'fileName must be up to 200 characters';
    if (!(await workspaceOf(env, ctx.artifactId))) return 'Syncing from a link needs a page inside a workspace.';
    return null;
  },

  async deliver(env, ctx, config) {
    const steps: DeliveryStep[] = [];
    let t0 = Date.now();
    const fail = (step: string, error: string) => {
      steps.push({ step, status: 'failed', durationMs: Date.now() - t0, detail: { error } });
      return { success: false, error, steps };
    };
    if (!(await workspaceOf(env, ctx.artifactId))) return fail('fetch', 'Syncing from a link needs a page inside a workspace.');

    const sheetWanted = (config.sheet || '').trim();
    let phase = 'fetch';
    try {
      const file = await fetchPublicSheet(parseShareLink(config.link));
      const name = file.fileName || config.fileName || 'Shared spreadsheet';
      steps.push({ step: 'fetch', status: 'success', durationMs: Date.now() - t0, detail: { file: name, bytes: file.bytes.byteLength } });

      phase = 'transform'; t0 = Date.now();
      const parsed = await sheetRows(file.bytes, sheetWanted);
      const key = await publicSheetKey(parsed.sheet, parsed.rows);
      const current = await env.DB.prepare('SELECT metadata FROM datasets WHERE artifact_id = ? AND name = ?')
        .bind(ctx.artifactId, config.dataset).first<{ metadata: string | null }>();
      let prevKey: string | undefined;
      try { prevKey = (JSON.parse(current?.metadata || '{}') as { source?: { key?: string } }).source?.key; } catch { /* rewrite it */ }
      steps.push({ step: 'transform', status: 'success', durationMs: Date.now() - t0, detail: { sheet: parsed.sheet, rowCount: parsed.rows.length, unchanged: prevKey === key } });
      if (prevKey === key) return { success: true, steps };

      phase = 'deliver'; t0 = Date.now();
      const res = await writeDatasetRows(env, ctx.artifactId, config.dataset, 'json', parsed.rows, {
        source: { provider: 'public_link', key, file: name, sheet: parsed.sheet, syncedAt: new Date().toISOString() },
      });
      steps.push({ step: 'deliver', status: 'success', durationMs: Date.now() - t0, detail: { dataset: res.name, version: res.version, rowCount: res.rowCount } });
      return { success: true, steps };
    } catch (e) {
      const msg = e instanceof PublicLinkError || e instanceof SheetRowsError ? e.message : (e instanceof Error ? e.message : 'Sync from link failed');
      return fail(phase, msg);
    }
  },
};
