import type { Env } from '../types';
import { createMiniDb } from './minidb-client';

const CONFIG_KEY = '_viewer_config';
const CACHE_TTL = 60;

export interface ViewerConfig {
  /** When true, the floating ShareOut toolbar is not rendered at all. */
  hide_toolbar: boolean;
  /** When true, show the toolbar on small screens (hidden on mobile by default). */
  show_on_mobile: boolean;
}

const DEFAULT_VIEWER_CONFIG: ViewerConfig = {
  hide_toolbar: false,
  show_on_mobile: false,
};

function parseViewerConfig(raw: string | null | undefined): ViewerConfig {
  if (!raw) return { ...DEFAULT_VIEWER_CONFIG };
  try {
    const cfg = JSON.parse(raw) as Partial<ViewerConfig>;
    return {
      hide_toolbar: cfg.hide_toolbar === true,
      show_on_mobile: cfg.show_on_mobile === true,
    };
  } catch {
    return { ...DEFAULT_VIEWER_CONFIG };
  }
}

/**
 * Read-through KV cache for per-artifact viewer chrome settings.
 * Stored in the per-artifact mini-store under `_viewer_config`.
 */
export async function getViewerConfig(env: Env, artifactId: string): Promise<ViewerConfig> {
  const key = `vwcfg:${artifactId}`;
  if (env.SLUGS) {
    try {
      const cached = await env.SLUGS.get(key);
      if (cached !== null) return parseViewerConfig(cached);
    } catch {}
  }

  let config = { ...DEFAULT_VIEWER_CONFIG };
  try {
    const row = await createMiniDb(env, artifactId, '').prepare(
      'SELECT value FROM artifact_json WHERE artifact_id = ? AND key = ?'
    ).bind(artifactId, CONFIG_KEY).first<{ value: string }>();
    config = parseViewerConfig(row?.value);
  } catch {
    config = { ...DEFAULT_VIEWER_CONFIG };
  }

  if (env.SLUGS) {
    try {
      await env.SLUGS.put(key, JSON.stringify(config), { expirationTtl: CACHE_TTL });
    } catch {}
  }
  return config;
}

/** Bust the viewer-config KV cache after a write. */
export async function bustViewerConfigCache(env: Env, artifactId: string): Promise<void> {
  if (!env.SLUGS) return;
  try { await env.SLUGS.delete(`vwcfg:${artifactId}`); } catch {}
}

export { CONFIG_KEY as VIEWER_CONFIG_KEY };
