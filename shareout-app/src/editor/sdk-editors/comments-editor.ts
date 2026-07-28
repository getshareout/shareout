import { createMiniDb } from '../../data/minidb-client';
import { readJsonValue, writeJsonValue } from './json-editor';
import { dispatchAction } from './dispatch';
import { errorResponse, jsonResponse } from './response';
import type { SDKEditorHandler } from './types';

// Comments config is stored as the `_comments_config` key in the per-artifact
// JSON mini-store (read by src/serve/comments-config.ts), NOT a D1 table. Stats
// come from the real `artifact_comments` table (resolved flag, migration 0044).
const CONFIG_KEY = '_comments_config';

// Match data-tier DEFAULT_CONFIG (src/data/comments/types.ts) so the editor
// never shows "disabled" when the runtime still serves comments as enabled.
const DEFAULT_COMMENTS_CONFIG = {
  enabled: true,
  identityMode: 'anonymous' as const,
  allowReplies: true,
  maxDepth: 3,
  overlayEnabled: true,
  requireApproval: false,
};

interface StoredConfig {
  enabled?: boolean;
  overlayEnabled?: boolean;
  identityMode?: string;
  allowReplies?: boolean;
  maxDepth?: number;
  requireApproval?: boolean;
}

export const handleCommentsEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;
  const db = createMiniDb(env, artifactId, '');

  return dispatchAction(action, {
    get: async () => {
      const cfg = await readJsonValue<StoredConfig>(db, artifactId, CONFIG_KEY);
      const config = cfg
        ? {
            enabled: cfg.enabled !== false && cfg.overlayEnabled !== false,
            identityMode: cfg.identityMode || 'anonymous',
            allowReplies: cfg.allowReplies !== false,
            maxDepth: cfg.maxDepth || 3,
            requireApproval: cfg.requireApproval === true,
          }
        : { ...DEFAULT_COMMENTS_CONFIG };

      const stats = await env.DB.prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END) as resolved
         FROM artifact_comments WHERE artifact_id = ?`
      ).bind(artifactId).first<{ total: number; resolved: number }>();

      const total = stats?.total || 0;
      const resolved = stats?.resolved || 0;
      return jsonResponse({
        success: true,
        config,
        stats: { total, resolved, open: total - resolved },
      });
    },

    update: async () => {
      let body: StoredConfig;
      try {
        body = await request.json() as StoredConfig;
      } catch {
        return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400);
      }

      const enabled = body.enabled === true;
      await writeJsonValue(db, artifactId, CONFIG_KEY, {
        enabled,
        overlayEnabled: enabled,
        identityMode: body.identityMode || 'anonymous',
        allowReplies: body.allowReplies !== false,
        maxDepth: body.maxDepth || 3,
        requireApproval: body.requireApproval === true,
      });

      // Bust the comments-overlay KV cache so serving reflects the change immediately.
      if (env.SLUGS) {
        try { await env.SLUGS.delete(`cmtcfg:${artifactId}`); } catch { /* best effort */ }
      }

      return jsonResponse({ success: true });
    },
  });
};
