import { dispatchAction } from './dispatch';
import { jsonResponse } from './response';
import type { SDKEditorHandler } from './types';

export const handleSheetsEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;

  return dispatchAction(action, {
    get: async () => {
      const config = await env.DB.prepare(`
        SELECT spreadsheet_id, range, sync_mode, refresh_interval, last_sync
        FROM artifact_sheets_config
        WHERE artifact_id = ?
      `).bind(artifactId).first<{
        spreadsheet_id: string;
        range: string;
        sync_mode: string;
        refresh_interval: number;
        last_sync: string;
      }>();

      return jsonResponse({
        success: true,
        config: config ? {
          spreadsheetId: config.spreadsheet_id,
          range: config.range,
          syncMode: config.sync_mode,
          refreshInterval: config.refresh_interval,
          lastSync: config.last_sync,
        } : null,
      });
    },

    update: async () => {
      const body = await request.json() as {
        spreadsheetId: string;
        range?: string;
        syncMode?: string;
        refreshInterval?: number;
      };

      await env.DB.prepare(`
        INSERT INTO artifact_sheets_config
        (artifact_id, spreadsheet_id, range, sync_mode, refresh_interval)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(artifact_id) DO UPDATE SET
          spreadsheet_id = excluded.spreadsheet_id,
          range = excluded.range,
          sync_mode = excluded.sync_mode,
          refresh_interval = excluded.refresh_interval
      `).bind(
        artifactId,
        body.spreadsheetId,
        body.range || 'A:Z',
        body.syncMode || 'manual',
        body.refreshInterval || 0
      ).run();

      return jsonResponse({ success: true });
    },
  });
};
