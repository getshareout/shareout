import type { Env } from '../../types';
import type { DataContext } from '../middleware';
import { createMiniDb } from '../minidb-client';
import { generateId } from '../../crypto-utils';
import { resolveAgentAiConfig, recordAgentUsage, resolveWorkspaceAi } from './ai-config';
import { buildAdminContext, buildAdminSystemPrompt } from './context';
import { streamChat } from './anthropic';
import { recordUsage } from './usage';
import { parseEditSuggestions, applyEditsToPending, publishConversation } from './admin-chat';
import { crewProviderFor, getCrewProvider } from '../../crew/provider';
import { decodeText, isTextMime } from '../../artifacts/files';
import { runEditAgent, type EditAgentResult } from '../../build-agent/edit-agent';
import { buildAgentEnabled } from '../../build-agent/run';
import { localeForRecipient, type Locale } from '../../i18n/locale';

// Drive the (server-side) admin edit agent without HTTP/SSE — for callers like
// the Telegram bot. proposeEdit generates + stages edits and returns a summary;
// publishEdits promotes them to a live version. Reuses the same agent, billing,
// pending-edit staging, and publish path as the in-app editor. proposeEditInPieces
// is the tool-using editor (build-agent/edit-agent) staged through the same path.

export type ProposeEditResult =
  | { ok: false; error: string }
  | { ok: true; conversationId: string; explanation: string; files: string[]; diff: string[]; stagedHash: string };

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

async function stagedEditsHash(env: Env, artifactId: string, conversationId: string): Promise<string> {
  const rows = await env.DB.prepare(
    `SELECT file_path, new_content FROM artifact_pending_edits
      WHERE artifact_id = ? AND thread_id = ? AND status = 'pending' ORDER BY file_path`
  ).bind(artifactId, conversationId).all<{ file_path: string; new_content: string | null }>();
  const bytes = new TextEncoder().encode(JSON.stringify(rows.results.map((r) => [r.file_path, r.new_content ?? ''])));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const DIFF_MAX_LINES = 60;
const DIFF_LINE_CHARS = 200;

/** Changed lines (- removed, + added) of every staged file, so the confirm prompt shows what will actually go live. */
function stagedDiff(rows: Array<{ file_path: string; original_content: string; new_content: string }>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const before = r.original_content.split('\n').map((l) => l.trim()).filter(Boolean);
    const after = r.new_content.split('\n').map((l) => l.trim()).filter(Boolean);
    const had = new Set(before);
    const has = new Set(after);
    out.push(`--- ${r.file_path}`);
    for (const l of before) if (!has.has(l)) out.push(`- ${l.slice(0, DIFF_LINE_CHARS)}`);
    for (const l of after) if (!had.has(l)) out.push(`+ ${l.slice(0, DIFF_LINE_CHARS)}`);
  }
  return out.length > DIFF_MAX_LINES
    ? [...out.slice(0, DIFF_MAX_LINES), `… ${out.length - DIFF_MAX_LINES} more changed lines not shown`]
    : out;
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
  for await (const chunk of streamChat(env, { workspaceId: ctx.artifact.workspace_id, userId: null, kind: 'artifact_ai_edit', source: artifactId }, [{ role: 'user', content: instruction }], systemPrompt, model, 8192, aiConfig)) {
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
    return { ok: true, conversationId, explanation: explanationFrom(content) || 'I didn’t find a change to make.', files: [], diff: [], stagedHash: '' };
  }

  const applied = await applyEditsToPending(ctx, conversationId, suggested);
  const files = applied.filter((a) => a.success).map((a) => a.file);
  const staged = await env.DB.prepare(
    `SELECT file_path, original_content, new_content FROM artifact_pending_edits
      WHERE artifact_id = ? AND thread_id = ? AND status = 'pending'`
  ).bind(artifactId, conversationId).all<{ file_path: string; original_content: string; new_content: string }>();
  return { ok: true, conversationId, explanation: explanationFrom(content), files, diff: stagedDiff(staged.results), stagedHash: await stagedEditsHash(env, artifactId, conversationId) };
}

/** A file bigger than this is left read-only for the piecewise editor. */
const MAX_EDIT_FILE_BYTES = 1_000_000;

/** What edit_page tells the model when the piecewise editor gave up (the model relays it in the user's language). */
function editGiveUpText(r: Extract<EditAgentResult, { ok: false }>): string {
  switch (r.reason) {
    case 'budget': return r.detail;
    case 'provider_error': return 'The editor agent hit an error. Try again?';
    case 'check_failed': return 'I could not make that change without breaking the page, so nothing was changed. Try a smaller or more specific change?';
    default: return 'I could not finish that change in time, so nothing was changed. Try a smaller or more specific change?';
  }
}

/** Skills and libraries carry sidecars a file edit would not keep (same rule as POST /v1/artifacts/{id}/edits). */
function isSkillOrLibrary(typeMetadata: string | null): boolean {
  if (!typeMetadata) return false;
  try {
    const meta = JSON.parse(typeMetadata) as { skill?: unknown; library?: unknown } | null;
    return !!(meta?.skill || meta?.library);
  } catch {
    return false;
  }
}

interface ArtifactForEdit {
  workspace_id: string | null;
  visibility: string;
  artifact_type: string;
  type_metadata: string | null;
  folder_id: string | null;
}

/**
 * The tool-using page editor (build-agent/edit-agent): edits the page's files in pieces,
 * checks them, and stages the changed files as a pending edit, exactly like proposeEdit, so
 * the user still confirms before publishEdits makes it live. Follows the build agent's switch
 * (BUILD_AGENT / the ai.build_agent flag for the page's workspace). Returns null where it does
 * not apply (switch off, not an HTML page, a skill or library, no AI provider): the caller uses
 * proposeEdit.
 */
export async function proposeEditInPieces(
  env: Env,
  artifactId: string,
  instruction: string,
  opts: { userId: string | null; onProgress?: (label: string) => void },
): Promise<ProposeEditResult | null> {
  const artifact = await env.DB.prepare(
    'SELECT workspace_id, visibility, artifact_type, type_metadata, folder_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<ArtifactForEdit>();
  if (!artifact || artifact.artifact_type !== 'html' || isSkillOrLibrary(artifact.type_metadata)) return null;
  if (!(await buildAgentEnabled(env, artifact.workspace_id))) return null;
  const head = await env.DB.prepare(
    'SELECT id, entrypoint FROM versions WHERE artifact_id = ? ORDER BY version_no DESC LIMIT 1'
  ).bind(artifactId).first<{ id: string; entrypoint: string }>();
  if (!head) return { ok: false, error: 'This page has no version to edit yet.' };

  const ai = await resolveWorkspaceAi(env, artifact.workspace_id);
  const provider = ai.byo ? crewProviderFor(env, ai.byo) : getCrewProvider(env, ai.gatewayModel);
  if (!provider) return null;

  const { results: assets } = await env.DB.prepare('SELECT path, r2_key, mime, size_bytes FROM assets WHERE version_id = ?')
    .bind(head.id).all<{ path: string; r2_key: string; mime: string; size_bytes: number }>();
  const files: Array<{ path: string; content: string; mime: string }> = [];
  const readOnly: Array<{ path: string; mime: string }> = [];
  await Promise.all((assets ?? []).map(async (a) => {
    const obj = isTextMime(a.mime) && a.size_bytes <= MAX_EDIT_FILE_BYTES ? await env.ARTIFACTS.get(a.r2_key) : null;
    let text: string | null = null;
    if (obj) {
      try {
        text = decodeText(new Uint8Array(await obj.arrayBuffer()), true);
      } catch {
        text = null; // Not UTF-8: leave it alone.
      }
    }
    if (text === null) readOnly.push({ path: a.path, mime: a.mime });
    else files.push({ path: a.path, content: text, mime: a.mime });
  }));
  if (!files.some((f) => f.path === head.entrypoint)) return null;

  const guide = artifact.folder_id
    ? (await env.DB.prepare('SELECT readme FROM folders WHERE id = ?').bind(artifact.folder_id).first<{ readme: string | null }>())?.readme?.trim() || null
    : null;
  const locale = await localeForRecipient(env, { userId: opts.userId, workspaceId: artifact.workspace_id }).catch((): Locale => 'en');

  const result = await runEditAgent(
    {
      env,
      provider,
      meter: { workspaceId: artifact.workspace_id, userId: opts.userId, kind: 'artifact_ai_edit', source: artifactId },
      locale,
      isPublic: artifact.visibility === 'public',
      onProgress: opts.onProgress,
    },
    { instruction, entrypoint: head.entrypoint, files, readOnly, guide },
  );
  const { inputTokens, outputTokens } = result.usage;
  await recordUsage(env, artifactId, 'admin', inputTokens, outputTokens);
  await recordAgentUsage(env, {
    workspaceId: artifact.workspace_id, artifactId, conversationId: null, mode: 'admin',
    provider: provider.provider, model: provider.model, inputTokens, outputTokens, byo: !!ai.byo,
  });
  if (!result.ok) return { ok: false, error: editGiveUpText(result) };
  if (!result.changed.length) {
    return { ok: true, conversationId: '', explanation: result.summary || 'I didn’t find a change to make.', files: [], diff: [], stagedHash: '' };
  }

  const conversationId = generateId('conv');
  const summary = result.summary || `Changed ${result.changed.map((c) => c.path).join(', ')}.`;
  await env.DB.prepare(
    `INSERT INTO agent_threads (id, scope_type, scope_key, title, created_at, updated_at)
     VALUES (?, 'artifact_admin', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(conversationId, artifactId, instruction.slice(0, 100)).run();
  await env.DB.prepare(
    `INSERT INTO agent_messages (id, thread_id, role, content, created_at)
     VALUES (?, ?, 'user', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(generateId('msg'), conversationId, instruction).run();
  await env.DB.prepare(
    `INSERT INTO agent_messages (id, thread_id, role, content, input_tokens, output_tokens, model, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(generateId('msg'), conversationId, summary, inputTokens, outputTokens, provider.model).run();
  await env.DB.prepare(
    `UPDATE agent_threads SET message_count = message_count + 2,
       total_input_tokens = total_input_tokens + ?, total_output_tokens = total_output_tokens + ? WHERE id = ?`
  ).bind(inputTokens, outputTokens, conversationId).run();

  // Whole-file replacements of the changed files, through the same staging as the in-app editor.
  const ctx = await buildArtifactContext(env, artifactId);
  const applied = await applyEditsToPending(ctx, conversationId, result.changed.map((c) => ({ file: c.path, type: 'replace' as const, replace: c.after })));
  const failed = applied.filter((a) => !a.success);
  if (failed.length) return { ok: false, error: `The change could not be staged (${failed.map((f) => `${f.file}: ${f.error}`).join('; ')}). Nothing was changed.` };
  const staged = await env.DB.prepare(
    `SELECT file_path, original_content, new_content FROM artifact_pending_edits
      WHERE artifact_id = ? AND thread_id = ? AND status = 'pending'`
  ).bind(artifactId, conversationId).all<{ file_path: string; original_content: string; new_content: string }>();
  return {
    ok: true,
    conversationId,
    explanation: explanationFrom(summary),
    files: applied.map((a) => a.file),
    diff: stagedDiff(staged.results),
    stagedHash: await stagedEditsHash(env, artifactId, conversationId),
  };
}

export type PublishEditResult = { ok: false; error: string } | { ok: true; url: string | null };

/** Promote a proposed conversation's staged edits to a new live version. */
export async function publishEdits(env: Env, artifactId: string, conversationId: string, stagedHash: string | undefined, publishedBy: string): Promise<PublishEditResult> {
  if (!stagedHash || stagedHash !== await stagedEditsHash(env, artifactId, conversationId)) {
    return { ok: false, error: 'the staged edit changed after you were shown it — ask for the change again.' };
  }
  const ctx = await buildArtifactContext(env, artifactId);
  const result = await publishConversation(ctx, conversationId, undefined, publishedBy);
  return result.ok ? { ok: true, url: result.url } : { ok: false, error: result.error };
}
