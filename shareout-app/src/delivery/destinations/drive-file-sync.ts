import type { Destination, DeliveryStep } from '../types';
import type { DriveFileSyncConfig } from '../../scheduling/jobs/types';
import { providerConfig } from '../../file-imports/oauth';
import { accessTokenFor, findConnection } from '../../file-imports/connections';
import { DRIVE_FILE_ID, SHEET_MIMES, getDriveFile, googleDrive } from '../../file-imports/providers/google';
import { AuthExpiredError, ProviderError, RateLimitedError } from '../../file-imports/http';
import { SheetRowsError, sheetRows } from '../../data/files/sheet-rows';
import { XLSX_MAX_INPUT_BYTES } from '../../data/files/parse-xlsx';
import { writeDatasetRows } from '../../data/datasets/handler';
import { sha256 } from '../../crypto-utils';

// A Drive spreadsheet → one of the artifact's datasets, on the job's own schedule (hourly,
// daily, weekly …). Reads through the job owner's Google Drive connection (the one the
// folder import uses). An unchanged file — same Drive revision, same tab — is skipped, so
// an hourly schedule costs one metadata call while nothing moves. No AI: the tab's rows
// land as JSON that the page reads with the SDK's dataset store.

const DATASET_NAME = /^[a-zA-Z0-9_.-]{1,64}$/;
const SHEET_EXT = /\.(xlsx|xlsm|xls|ods|csv)$/i;

async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/** Same file + tab + Drive revision → same key. Hashed: dataset metadata is readable by the
 *  page's viewers, and it should not carry the Drive file id. */
export async function driveSourceKey(fileId: string, sheet: string, revision: string): Promise<string> {
  const hex = await sha256(new TextEncoder().encode(`${fileId}\n${sheet}\n${revision}`).buffer as ArrayBuffer);
  return hex.slice(0, 32);
}

function driveError(e: unknown): string {
  if (e instanceof AuthExpiredError) return 'Google Drive access expired or was revoked. Reconnect Google Drive, then run the sync again.';
  if (e instanceof RateLimitedError) return e.message;
  if (e instanceof ProviderError) {
    if (e.status === 404) return 'The file is gone or no longer shared with the job owner.';
    if (e.status === 403) return 'The job owner no longer has access to this file.';
    return `Google Drive could not be read: ${e.message}`;
  }
  return e instanceof Error ? e.message : 'Drive sync failed';
}

export const driveFileSyncDestination: Destination<DriveFileSyncConfig> = {
  kind: 'drive_file_sync',

  async validate(env, _ctx, config) {
    if ((config?.provider ?? 'google_drive') !== 'google_drive') return 'drive_file_sync supports provider "google_drive" only';
    if (typeof config?.fileId !== 'string' || !DRIVE_FILE_ID.test(config.fileId)) return 'drive_file_sync requires a Google Drive fileId';
    if (typeof config.dataset !== 'string' || !DATASET_NAME.test(config.dataset)) {
      return 'drive_file_sync requires a dataset name (letters, digits, _ . -, up to 64)';
    }
    if (config.sheet !== undefined && (typeof config.sheet !== 'string' || config.sheet.length > 100)) return 'sheet must be a tab name (up to 100 characters)';
    if (!providerConfig(env, 'google_drive')) return 'Google Drive is not set up on this instance';
    return null;
  },

  async deliver(env, ctx, config) {
    const steps: DeliveryStep[] = [];
    let t0 = Date.now();
    const fail = (step: string, error: string) => {
      steps.push({ step, status: 'failed', durationMs: Date.now() - t0, detail: { error } });
      return { success: false, error, steps };
    };

    const art = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
      .bind(ctx.artifactId).first<{ workspace_id: string | null }>();
    if (!art?.workspace_id) return fail('fetch', 'Drive sync needs a page inside a workspace.');
    const conn = await findConnection(env, art.workspace_id, ctx.createdBy, 'google_drive');
    if (!conn) return fail('fetch', 'The job owner has not connected Google Drive in this workspace.');

    const sheetWanted = (config.sheet || '').trim();
    let token = '';
    // A 401 mid-run gets one forced refresh, like the import routes.
    const withToken = async <T>(fn: (tk: string) => Promise<T>): Promise<T> => {
      try { return await fn(token); } catch (e) {
        if (!(e instanceof AuthExpiredError)) throw e;
        token = await accessTokenFor(env, conn, true);
        return fn(token);
      }
    };

    let phase = 'fetch';
    try {
      token = await accessTokenFor(env, conn);
      const entry = await withToken((tk) => getDriveFile(tk, config.fileId));
      if (entry.kind !== 'file') return fail('fetch', 'That Drive item is a folder, not a spreadsheet.');
      if (!SHEET_MIMES.includes(entry.mime || '') && !SHEET_EXT.test(entry.name)) {
        return fail('fetch', `"${entry.name}" is not a spreadsheet (Excel, Google Sheets, OpenDocument or CSV).`);
      }

      const key = await driveSourceKey(entry.id, sheetWanted, entry.version || '');
      const current = await env.DB.prepare('SELECT metadata FROM datasets WHERE artifact_id = ? AND name = ?')
        .bind(ctx.artifactId, config.dataset).first<{ metadata: string | null }>();
      let prevKey: string | undefined;
      try { prevKey = (JSON.parse(current?.metadata || '{}') as { source?: { key?: string } }).source?.key; } catch { /* rewrite it */ }
      if (entry.version && prevKey === key) {
        steps.push({ step: 'fetch', status: 'success', durationMs: Date.now() - t0, detail: { file: entry.name, modifiedAt: entry.version, unchanged: true } });
        return { success: true, steps };
      }

      const dl = await withToken((tk) => googleDrive.download(tk, null, entry));
      if (!dl.ok) return fail('fetch', dl.message);
      const bytes = await readCapped(dl.body, XLSX_MAX_INPUT_BYTES);
      if (!bytes) return fail('fetch', `Spreadsheets up to ${XLSX_MAX_INPUT_BYTES / 1_000_000} MB can be synced.`);
      steps.push({ step: 'fetch', status: 'success', durationMs: Date.now() - t0, detail: { file: entry.name, modifiedAt: entry.version, bytes: bytes.byteLength } });

      phase = 'transform'; t0 = Date.now();
      const parsed = await sheetRows(bytes, sheetWanted);
      steps.push({ step: 'transform', status: 'success', durationMs: Date.now() - t0, detail: { sheet: parsed.sheet, rowCount: parsed.rows.length } });

      phase = 'deliver'; t0 = Date.now();
      const res = await writeDatasetRows(env, ctx.artifactId, config.dataset, 'json', parsed.rows, {
        source: { provider: 'google_drive', key, file: entry.name, sheet: parsed.sheet, modifiedAt: entry.version ?? null, syncedAt: new Date().toISOString() },
      });
      steps.push({ step: 'deliver', status: 'success', durationMs: Date.now() - t0, detail: { dataset: res.name, version: res.version, rowCount: res.rowCount } });
      return { success: true, steps };
    } catch (e) {
      return fail(phase, e instanceof SheetRowsError ? e.message : driveError(e));
    }
  },
};
