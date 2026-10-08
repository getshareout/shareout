/**
 * Editor chat configuration. Provider selection lives in the shared agent layer
 * (data/agent/anthropic.ts + ai-config.ts); this module only holds editor limits
 * and debug logging.
 *
 * Set `DEBUG = true` locally to trace prompts, SSE events, and parsed patches.
 */

export const EDITOR_MAX_TOKENS = 8192;

/** EDIT-10 F2: off in prod (was logging full prompts/patches/HTML previews). */
export const DEBUG = false;

export function debugLog(category: string, message: string, data?: unknown): void {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ` ${JSON.stringify(data, null, 0)}` : '';
  console.log(`[EditorChat ${timestamp}] [${category}] ${message}${dataStr}`);
}

export function debugError(category: string, message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  console.error(`[EditorChat ${timestamp}] [${category}] ERROR: ${message}`, error);
}
