import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { createLogger } from '../logging';

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
    inputTokens?: number;
    outputTokens?: number;
    costSource?: 'pending' | 'estimate' | 'actual' | 'unpriced';
    providerRef?: string | null;
  }
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO ai_usage_events (
      id, workspace_id, user_id, kind, model, units, unit_kind, base_cost_micro_usd, source, input_tokens, output_tokens, cost_source, provider_ref, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).bind(
    generateId('aiu'),
    params.workspaceId,
    params.userId,
    params.kind,
    params.model,
    params.units,
    params.unitKind,
    params.baseCostMicroUsd,
    params.source ?? null,
    params.inputTokens ?? null,
    params.outputTokens ?? null,
    params.costSource ?? null,
    params.providerRef ?? null
  ).run();
}

/**
 * Who an LLM call is for. Required by every provider entry point (streamChat,
 * chatComplete, crew providers, page pilot, moderation) so no model call goes
 * unrecorded: workspaceId null = personal / instance-level work.
 */
export interface AiMeter {
  workspaceId: string | null;
  userId: string | null;
  /** What the call was for, e.g. 'assistant_chat', 'pdf_transcription'. */
  kind: string;
  source?: string | null;
}

/**
 * Record one model call's real token usage. Never throws: a ledger write must not fail the
 * call. The row is written `pending` with no cost; the hourly reconcile (ai-usage-reconcile)
 * fills in what the AI Gateway debited, found by `providerRef` (its generation id), or the
 * live catalog list price for providers with no cost lookup.
 */
export async function meterAiCall(env: Env, meter: AiMeter, model: string, inputTokens: number, outputTokens: number, providerRef?: string | null): Promise<void> {
  if (inputTokens + outputTokens <= 0) return;
  await recordAiUsage(env, {
    workspaceId: meter.workspaceId, userId: meter.userId, kind: meter.kind, model,
    units: inputTokens + outputTokens, unitKind: 'tokens',
    baseCostMicroUsd: 0,
    source: meter.source ?? null,
    inputTokens, outputTokens,
    costSource: 'pending',
    providerRef: providerRef ?? null,
  }).catch((err) => {
    createLogger(env, { scope: 'ai' }).error('AI usage not recorded', { kind: meter.kind, model, error: String(err) });
  });
}
