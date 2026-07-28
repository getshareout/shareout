/**
 * Visitor AI chat agent config upsert from publish payload.
 *
 * Lets owners enable/configure the chat agent without a separate
 * PUT /v1/data/:id/agent/config call. Only provided fields are written;
 * omitted fields keep their current value (or sensible defaults on first insert).
 */
import type { AgentPublishConfig, Env } from '../types';

export async function upsertAgentConfig(env: Env, artifactId: string, agent: AgentPublishConfig): Promise<void> {
  const tables = agent.contextTables ? JSON.stringify(agent.contextTables) : null;
  const existing = await env.DB.prepare(
    'SELECT artifact_id FROM artifact_agent_config WHERE artifact_id = ?'
  ).bind(artifactId).first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE artifact_agent_config SET
        visitor_enabled = COALESCE(?, visitor_enabled),
        visitor_system_prompt = COALESCE(?, visitor_system_prompt),
        visitor_model = COALESCE(?, visitor_model),
        visitor_max_tokens = COALESCE(?, visitor_max_tokens),
        visitor_temperature = COALESCE(?, visitor_temperature),
        visitor_context_json = COALESCE(?, visitor_context_json),
        visitor_context_tables = COALESCE(?, visitor_context_tables),
        visitor_context_blobs = COALESCE(?, visitor_context_blobs),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE artifact_id = ?
    `).bind(
      agent.enabled !== undefined ? (agent.enabled ? 1 : 0) : null,
      agent.systemPrompt ?? null,
      agent.model ?? null,
      agent.maxTokens ?? null,
      agent.temperature ?? null,
      agent.contextJson !== undefined ? (agent.contextJson ? 1 : 0) : null,
      tables,
      agent.contextBlobs !== undefined ? (agent.contextBlobs ? 1 : 0) : null,
      artifactId,
    ).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO artifact_agent_config (
        artifact_id, visitor_enabled, visitor_system_prompt, visitor_model,
        visitor_max_tokens, visitor_temperature, visitor_context_json,
        visitor_context_tables, visitor_context_blobs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      artifactId,
      agent.enabled === false ? 0 : 1,
      agent.systemPrompt ?? null,
      agent.model ?? 'claude-sonnet-4-20250514',
      agent.maxTokens ?? 4096,
      agent.temperature ?? 0.7,
      agent.contextJson !== false ? 1 : 0,
      tables,
      agent.contextBlobs ? 1 : 0,
    ).run();
  }
}
