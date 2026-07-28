/**
 * Shared helpers for home activity-feed queries (Needs You, Pulse, summaries).
 */
import type { WorkspaceRole } from '../../../types';
import type { PulseWindow } from '../types';
import type { EventAudience } from '../events';

/** Options threaded through activity-feed queries (Needs You, Pulse, For You, etc.). */
export interface ActivityFeedOpts {
  /** Workspace context; null/undefined = the user's personal artifacts. */
  workspaceId?: string | null;
  /** Max events returned after the merge (per-source queries also cap at this). */
  limit?: number;
  /** Pulse aggregation window (ambient layer only). Default '7d'. */
  window?: PulseWindow;
}

const WINDOW_SECONDS: Record<PulseWindow, number> = { today: 0, '7d': 7 * 86400, '30d': 30 * 86400 };

/** Unix timestamp cutoff for a pulse aggregation window. */
export function windowCutoff(window: PulseWindow): number {
  const now = Math.floor(Date.now() / 1000);
  return window === 'today' ? now - (now % 86400) : now - WINDOW_SECONDS[window];
}

/** Truncate activity summaries to a single-line card width. */
export function trim140(t: string): string {
  return t.length > 140 ? t.slice(0, 137) + '…' : t;
}

// Comment bodies may carry canonical entity tokens ([[a:slug|Label]] / [[s:id|Label]])
// for the Inspector's mention chips; collapse them to their label for plain summaries.
export function stripMentionTokens(t: string): string {
  return (t || '').replace(/\[\[[as]:[^|\]]+\|([^\]]+)\]\]/g, '$1');
}

/** A pulse source's effective scope after audience × role: skip it, the viewer's
 *  own slice only, or the full (workspace- or personal-) visible set. */
export type KindScope = 'skip' | 'own' | 'full';

export function kindScope(aud: EventAudience, role: WorkspaceRole | null, isPersonal: boolean): KindScope {
  if (aud === 'off') return 'skip';
  if (isPersonal) return 'own';            // personal scope: everything is already yours
  if (aud === 'self') return 'own';
  if (aud === 'members') return 'full';
  return role === 'owner' || role === 'admin' ? 'full' : 'skip'; // admins
}
