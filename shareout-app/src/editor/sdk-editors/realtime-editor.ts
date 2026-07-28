import { dispatchAction } from './dispatch';
import { jsonResponse } from './response';
import type { SDKEditorContext, SDKEditorHandler } from './types';

function getDocId(ctx: SDKEditorContext): string {
  return ctx.component.name || 'default';
}

export const handleRealtimeEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;
  const docId = getDocId(ctx);

  return dispatchAction(action, {
    get: async () => {
      const config = await env.DB.prepare(`
        SELECT doc_id, show_presence, show_cursors, max_connections
        FROM artifact_realtime_config
        WHERE artifact_id = ? AND doc_id = ?
      `).bind(artifactId, docId).first<{
        doc_id: string;
        show_presence: number;
        show_cursors: number;
        max_connections: number;
      }>();

      return jsonResponse({
        success: true,
        config: config ? {
          docId: config.doc_id,
          showPresence: config.show_presence === 1,
          showCursors: config.show_cursors === 1,
          maxConnections: config.max_connections || 50,
        } : {
          docId,
          showPresence: true,
          showCursors: true,
          maxConnections: 50,
        },
      });
    },

    update: async () => {
      const body = await request.json() as {
        showPresence?: boolean;
        showCursors?: boolean;
        maxConnections?: number;
      };

      await env.DB.prepare(`
        INSERT INTO artifact_realtime_config
        (artifact_id, doc_id, show_presence, show_cursors, max_connections)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(artifact_id, doc_id) DO UPDATE SET
          show_presence = excluded.show_presence,
          show_cursors = excluded.show_cursors,
          max_connections = excluded.max_connections
      `).bind(
        artifactId,
        docId,
        body.showPresence ? 1 : 0,
        body.showCursors ? 1 : 0,
        body.maxConnections || 50
      ).run();

      return jsonResponse({ success: true });
    },
  });
};
