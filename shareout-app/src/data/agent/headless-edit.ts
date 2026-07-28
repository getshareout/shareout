import type { Env } from '../../types';
import type { DataContext } from '../middleware';
import { createMiniDb } from '../minidb-client';
import { generateId } from '../../crypto-utils';
import { resolveAgentAiConfig, recordAgentUsage } from './ai-config';
import { buildAdminContext, buildAdminSystemPrompt } from './context';
import { streamChat } from './anthropic';
import { recordUsage } from './usage';
import { parseEditSuggestions, applyEditsToPending, publishConversation } from './admin-chat';

// Drive the (server-side) admin edit agent without HTTP/SSE — for callers like
// the Telegram bot. proposeEdit generates + stages edits and returns a summary;
// publishEdits promotes them to a live version. Reuses the same agent, billing,
// pending-edit staging, and publish path as the in-app editor.

export type ProposeEditResult =
  | { ok: false; error: string }
  | { ok: true; conversationId: string; explanation: string; files: string[] };

/** Build an owner-scoped DataContext for an artifact from env alone (no request). */
async function buildArtifactContext(env: Env, artifactId: string): Promise<DataContext> {
  const artifact = await env.DB.prepare(
    'SELECT id, name, visibility, auth_method, workspace_id, owner_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string; name: string; visibility: string; auth_method: string | null; workspace_id: string | null; owner_id: string | null }>();
  const workspaceId = artifact?.workspace_id ?? '';
  return {
    artifactId,
    workspaceId,
    artifact: artifact ?? { id: artifactId, name: '', visibility: 'private', auth_method: null, workspace_id: null, owner_id: null },
    db: createMiniDb(env, artifactId, workspaceId),
    env,
    origin: null,
    viewerScope: null,
  };
}

function explanationFrom(content: string): string {
  // Drop code/diff blocks — keep the prose so the confirm prompt reads cleanly.
  const prose = content.replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return prose.length > 600 ? prose.slice(0, 600) + '…' : prose;
}

/** Run the edit agent for one instruction; stage any edits as pending. No publish yet. */
export async function proposeEdit(env: Env, artifactId: string, instruction: string): Promise<ProposeEditResult> {
  const ai = await resolveAgentAiConfig(env, artifactId);
  if (!ai.aiConfig) return { ok: false, error: 'This page doesn’t have an AI editor configured yet.' };

  const aiConfig = ai.aiConfig;
  const model = aiConfig.model.replace(/^openai\//, '');
  const ctx = await buildArtifactContext(env, artifactId);

  const conversationId = generateId('conv');
  await env.DB.prepare(
    `INSERT INTO agent_threads (id, scope_type, scope_key, title, created_at, updated_at)
     VALUES (?, 'artifact_admin', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(conversationId, artifactId, instruction.slice(0, 100)).run();
  await env.DB.prepare(
    `INSERT INTO agent_messages (id, thread_id, role, content, created_at)
     VALUES (?, ?, 'user', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(generateId('msg'), conversationId, instruction).run();

  const systemPrompt = buildAdminSystemPrompt(await buildAdminContext(ctx));

  let content = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const chunk of streamChat(env, [{ role: 'user', content: instruction }], systemPrompt, model, 8192, aiConfig)) {
    if (chunk.type === 'content' && chunk.content) content += chunk.content;
    else if (chunk.type === 'done' && chunk.usage) {
      inputTokens = chunk.usage.input_tokens;
      outputTokens = chunk.usage.output_tokens;
    } else if (chunk.type === 'error') {
      return { ok: false, error: 'The editor agent hit an error. Try again?' };
    }
  }

  const suggested = parseEditSuggestions(content);

  await env.DB.prepare(
    `INSERT INTO agent_messages (id, thread_id, role, content, suggested_edits, input_tokens, output_tokens, model, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(generateId('msg'), conversationId, content, suggested.length ? JSON.stringify(suggested) : null, inputTokens, outputTokens, model).run();
  await env.DB.prepare(
    `UPDATE agent_threads SET message_count = message_count + 2,
       total_input_tokens = total_input_tokens + ?, total_output_tokens = total_output_tokens + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).bind(inputTokens, outputTokens, conversationId).run();
  await recordUsage(env, artifactId, 'admin', inputTokens, outputTokens);
  await recordAgentUsage(env, {
    workspaceId: ai.workspaceId,
    artifactId,
    conversationId,
    mode: 'admin',
    provider: aiConfig.provider,
    model: aiConfig.model,
    inputTokens,
    outputTokens,
    byo: ai.byo,
  });

  if (!suggested.length) {
    // The agent answered without proposing edits (a question, a refusal, etc.).
    return { ok: true, conversationId, explanation: explanationFrom(content) || 'I didn’t find a change to make.', files: [] };
  }

  const applied = await applyEditsToPending(ctx, conversationId, suggested);
  const files = applied.filter((a) => a.success).map((a) => a.file);
  return { ok: true, conversationId, explanation: explanationFrom(content), files };
}

export type PublishEditResult = { ok: false; error: string } | { ok: true; url: string | null };

/** Promote a proposed conversation's staged edits to a new live version. */
export async function publishEdits(env: Env, artifactId: string, conversationId: string): Promise<PublishEditResult> {
  const ctx = await buildArtifactContext(env, artifactId);
  const result = await publishConversation(ctx, conversationId);
  return result.ok ? { ok: true, url: result.url } : { ok: false, error: result.error };
}
