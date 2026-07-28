// Which provider key serves an artifact's agent, and how much its usage cost.
//
// There is no billing in this build: every request is allowed. A workspace either
// brings its own provider key (stored encrypted in workspace_llm_config) or falls
// back to the instance's platform key. Usage is still recorded so operators can see
// what their instance spends with the provider.
import type { Env } from '../../types';
import type { AgentMode } from './types';
import { generateId } from '../../crypto-utils';
import { decryptCredentials } from '../connections/credentials';
import { getAIProvider, buildAIConfig, type AIConfig, type AIProvider } from './anthropic';
import { computeBaseCostMicroUsd } from './model-costs';

export interface WorkspaceLlmConfigRow {
  workspace_id: string;
  byo_provider: AIProvider | null;
  byo_encrypted_credentials: string | null;
  byo_iv: string | null;
  balance_micro_usd: number;
  markup_multiplier: number;
  monthly_budget_micro_usd: number | null;
}

export interface AgentAiConfig {
  workspaceId: string | null;
  aiConfig: AIConfig | null;
  /** True when the workspace supplied its own provider key. */
  byo: boolean;
}

export async function resolveWorkspaceId(env: Env, artifactId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT workspace_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ workspace_id: string | null }>();
  return row?.workspace_id ?? null;
}

export async function getWorkspaceLlmConfig(
  env: Env,
  workspaceId: string
): Promise<WorkspaceLlmConfigRow | null> {
  return env.DB.prepare(
    'SELECT * FROM workspace_llm_config WHERE workspace_id = ?'
  ).bind(workspaceId).first<WorkspaceLlmConfigRow>();
}

export async function ensureConfigRow(env: Env, workspaceId: string): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO workspace_llm_config (workspace_id) VALUES (?)'
  ).bind(workspaceId).run();
}

/** Decide which provider key serves this artifact's agent. */
export async function resolveAgentAiConfig(env: Env, artifactId: string): Promise<AgentAiConfig> {
  const workspaceId = await resolveWorkspaceId(env, artifactId);
  const platform = getAIProvider(env);

  if (!workspaceId) return { workspaceId: null, aiConfig: platform, byo: false };

  const cfg = await getWorkspaceLlmConfig(env, workspaceId);
  if (cfg?.byo_provider && cfg.byo_encrypted_credentials && cfg.byo_iv && env.CREDENTIALS_KEY) {
    try {
      const data = await decryptCredentials(cfg.byo_encrypted_credentials, cfg.byo_iv, env.CREDENTIALS_KEY);
      const apiKey = typeof data.api_key === 'string' ? data.api_key : '';
      if (apiKey) {
        return { workspaceId, aiConfig: buildAIConfig(cfg.byo_provider, apiKey), byo: true };
      }
    } catch {
      // Decrypt failure — fall through to the platform key.
    }
  }

  return { workspaceId, aiConfig: platform, byo: false };
}

/** Append a per-request usage row so operators can see provider spend. */
export async function recordAgentUsage(
  env: Env,
  params: {
    workspaceId: string | null;
    artifactId: string;
    conversationId: string | null;
    mode: AgentMode;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    byo: boolean;
    // Crew attribution (null for visitor/admin chat).
    crewId?: string | null;
    runId?: string | null;
    triggerKind?: string | null;
    toolName?: string | null;
  }
): Promise<void> {
  const cost = computeBaseCostMicroUsd(params.model, params.inputTokens, params.outputTokens);

  await env.DB.prepare(`
    INSERT INTO agent_usage_events (
      id, workspace_id, artifact_id, conversation_id, mode, provider, model,
      input_tokens, output_tokens, base_cost_micro_usd, billed_cost_micro_usd, byo,
      crew_id, run_id, trigger_kind, tool_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).bind(
    generateId('aue'),
    params.workspaceId,
    params.artifactId,
    params.conversationId,
    params.mode,
    params.provider,
    params.model,
    params.inputTokens,
    params.outputTokens,
    cost,
    // Legacy column from the billing era: with no markup to apply, what the
    // instance is charged IS the model cost. Kept so existing usage views total.
    params.byo ? 0 : cost,
    params.byo ? 1 : 0,
    params.crewId ?? null,
    params.runId ?? null,
    params.triggerKind ?? null,
    params.toolName ?? null
  ).run();
}
