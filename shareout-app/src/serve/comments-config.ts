import type { Env } from '../types';
import { createMiniDb } from '../data/minidb-client';

// Cache the comments-overlay flag in KV so both serve paths (raw HTML + sandbox
// wrapper) stay cheap and cannot diverge.
const COMMENTS_OVERLAY_TTL = 60;

export type CommentsIdentityMode = 'anonymous' | 'named' | 'authenticated';

export interface CommentsViewerConfig {
  /** Overlay + feature enabled (enabled && overlayEnabled). */
  enabled: boolean;
  identityMode: CommentsIdentityMode;
}

const DEFAULT_VIEWER: CommentsViewerConfig = {
  enabled: true,
  identityMode: 'anonymous',
};

function parseViewerConfig(raw: string | null): CommentsViewerConfig {
  if (!raw) return { ...DEFAULT_VIEWER };
  // Legacy KV values: "1" / "0"
  if (raw === '1') return { ...DEFAULT_VIEWER, enabled: true };
  if (raw === '0') return { ...DEFAULT_VIEWER, enabled: false };
  try {
    const j = JSON.parse(raw) as { e?: number | boolean; m?: string; enabled?: boolean; identityMode?: string };
    const enabled = j.e === 1 || j.e === true || j.enabled === true
      ? true
      : j.e === 0 || j.e === false || j.enabled === false
        ? false
        : DEFAULT_VIEWER.enabled;
    const mode = j.m || j.identityMode;
    const identityMode: CommentsIdentityMode =
      mode === 'named' || mode === 'authenticated' || mode === 'anonymous'
        ? mode
        : 'anonymous';
    return { enabled, identityMode };
  } catch {
    return { ...DEFAULT_VIEWER };
  }
}

/**
 * Full comments viewer config (overlay on/off + identity mode). Prefer this over
 * the boolean helper when the toolbar needs guest vs login behavior.
 */
export async function getCommentsViewerConfig(env: Env, artifactId: string): Promise<CommentsViewerConfig> {
  const key = `cmtcfg:${artifactId}`;
  if (env.SLUGS) {
    try {
      const cached = await env.SLUGS.get(key);
      if (cached !== null) return parseViewerConfig(cached);
    } catch { /* fall through */ }
  }

  let cfg: CommentsViewerConfig = { ...DEFAULT_VIEWER };
  try {
    const row = await createMiniDb(env, artifactId, '').prepare(
      'SELECT value FROM artifact_json WHERE artifact_id = ? AND key = ?',
    ).bind(artifactId, '_comments_config').first<{ value: string }>();
    if (row) {
      const parsed = JSON.parse(row.value) as {
        enabled?: boolean;
        overlayEnabled?: boolean;
        identityMode?: string;
      };
      cfg = {
        enabled: parsed.enabled !== false && parsed.overlayEnabled !== false,
        identityMode:
          parsed.identityMode === 'named' ||
          parsed.identityMode === 'authenticated' ||
          parsed.identityMode === 'anonymous'
            ? parsed.identityMode
            : 'anonymous',
      };
    }
  } catch {
    cfg = { ...DEFAULT_VIEWER };
  }

  if (env.SLUGS) {
    try {
      await env.SLUGS.put(
        key,
        JSON.stringify({ e: cfg.enabled ? 1 : 0, m: cfg.identityMode }),
        { expirationTtl: COMMENTS_OVERLAY_TTL },
      );
    } catch { /* best effort */ }
  }
  return cfg;
}

/**
 * Read-through cache for the per-artifact comments-overlay flag. Reads the KV
 * `cmtcfg:{artifactId}` key first; on a miss, reads the config from the per-artifact
 * mini-store (ADR 28, empty workspace id bypasses the partition guard, read-only)
 * and writes the result back.
 */
export async function isCommentsOverlayEnabled(env: Env, artifactId: string): Promise<boolean> {
  const cfg = await getCommentsViewerConfig(env, artifactId);
  return cfg.enabled;
}
