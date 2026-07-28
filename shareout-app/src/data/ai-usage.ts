import type { Env } from '../types';
import { generateId } from '../crypto-utils';

// Workers AI Whisper is priced per audio-minute. micro-USD = 1 USD / 1_000_000,
// matching agent_usage_events. $0.00045/min = 450 micro-USD/min = 7.5 / second.
export const WHISPER_MICRO_USD_PER_AUDIO_SECOND = 7.5;

/** Cost in micro-USD for `seconds` of Whisper transcription (tracking only). */
export function whisperCostMicroUsd(seconds: number): number {
  return Math.round(Math.max(0, seconds) * WHISPER_MICRO_USD_PER_AUDIO_SECOND);
}

/**
 * Append a non-LLM Workers AI usage row for visibility. Unlike recordBilledUsage,
 * this NEVER debits a workspace balance — the surrounding account-agent LLM turns
 * are unbilled, so this ledger tracks cost without gating. Fire-and-forget safe.
 */
export async function recordAiUsage(
  env: Env,
  params: {
    workspaceId: string | null;
    userId: string | null;
    kind: string;
    model: string;
    units: number;
    unitKind: string;
    baseCostMicroUsd: number;
    source?: string | null;
  }
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO ai_usage_events (
      id, workspace_id, user_id, kind, model, units, unit_kind, base_cost_micro_usd, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).bind(
    generateId('aiu'),
    params.workspaceId,
    params.userId,
    params.kind,
    params.model,
    params.units,
    params.unitKind,
    params.baseCostMicroUsd,
    params.source ?? null
  ).run();
}
