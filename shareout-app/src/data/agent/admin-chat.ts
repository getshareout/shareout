import type { DataContext } from '../middleware';
import { errorResponse, successResponse } from '../middleware';
import { DATA_ERRORS } from '../../types';
import type { AdminChatRequest, ApplyEditsRequest, EditSuggestion, PendingEdit } from './types';
import { streamChat } from './anthropic';
import { buildAdminContext, buildAdminSystemPrompt } from './context';
import { buildAttachedSkillsDoc } from '../../skill-marketplace';
import { buildLibraryApiDoc } from '../../workspace-library';
import { recordUsage, recordError } from './usage';
import { resolveAgentAiConfig, recordAgentUsage } from './ai-config';
import {
  logAgentChatFailure,
  userFacingAdminContextFailure,
  userFacingAgentChatFailure,
  userFacingAgentStreamError,
  userFacingApplyEditError,
} from './errors';

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = prefix + '_';
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export async function handleAdminContext(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
  }

  try {
    const context = await buildAdminContext(ctx);
    return successResponse({ context }, 200, ctx.origin);
  } catch (error) {
    logAgentChatFailure(ctx.env, 'admin context build failed', error, {
      artifactId: ctx.artifactId,
      mode: 'admin',
    });
    return errorResponse({
      ...DATA_ERRORS.INTERNAL_ERROR,
      message: userFacingAdminContextFailure(error),
    }, ctx.origin);
  }
}

export async function handleAdminChat(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
  }

  let body: AdminChatRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' }, ctx.origin);
  }

  if (!body.message || typeof body.message !== 'string') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'message is required' }, ctx.origin);
  }

  const ai = await resolveAgentAiConfig(ctx.env, ctx.artifactId);
  if (!ai.aiConfig) {
    return errorResponse({ ...DATA_ERRORS.INTERNAL_ERROR, message: 'AI provider not configured' }, ctx.origin);
  }
  // AI credit gate (B7): only block a NEW conversation, never mid-stream. The
  const aiConfig = ai.aiConfig;
  const model = aiConfig.model.replace(/^openai\//, '');

  // Get or create conversation
  let conversationId = body.conversationId;
  let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  if (conversationId) {
    const existingMessages = await ctx.env.DB.prepare(`
      SELECT role, content FROM agent_messages
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `).bind(conversationId).all<{ role: string; content: string }>();

    messages = existingMessages.results.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  } else {
    conversationId = generateId('conv');

    await ctx.env.DB.prepare(`
      INSERT INTO agent_threads (id, scope_type, scope_key, title, created_at, updated_at)
      VALUES (?, 'artifact_admin', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `).bind(conversationId, ctx.artifactId, body.message.slice(0, 100)).run();
  }

  messages.push({ role: 'user', content: body.message });

  // Save user message
  const userMsgId = generateId('msg');
  await ctx.env.DB.prepare(`
    INSERT INTO agent_messages (id, thread_id, role, content, created_at)
    VALUES (?, ?, 'user', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).bind(userMsgId, conversationId, body.message).run();

  // Build admin context and system prompt
  const adminContext = await buildAdminContext(ctx);
  let systemPrompt = buildAdminSystemPrompt(adminContext);

  // Skill Marketplace: append the skills attached to this artifact as delimited,
  // explicitly-untrusted reference material (authoring path only). Best-effort.
  const attachedSkills = await buildAttachedSkillsDoc(
    ctx.env,
    ctx.artifactId,
    ctx.artifact.workspace_id,
    conversationId,
    ctx.waitUntil,
  );
  if (attachedSkills) systemPrompt += '\n\n' + attachedSkills;

  // Workspace Library: append the API surface (names, versions, exports, import paths)
  // of modules this artifact may import — its workspace + the owner's personal library —
  // so the agent writes correct imports. API catalog only, never module source.
  const libraryApi = await buildLibraryApiDoc(ctx.env, ctx.artifactId, ctx.artifact.workspace_id);
  if (libraryApi) systemPrompt += '\n\n' + libraryApi;

  // Stream response
  const encoder = new TextEncoder();
  let fullContent = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamChat(
          ctx.env,
          messages,
          systemPrompt,
          model,
          8192, // Higher limit for admin edits
          aiConfig
        )) {
          if (chunk.type === 'content' && chunk.content) {
            fullContent += chunk.content;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: chunk.content, conversationId })}\n\n`));
          } else if (chunk.type === 'done' && chunk.usage) {
            inputTokens = chunk.usage.input_tokens;
            outputTokens = chunk.usage.output_tokens;
          } else if (chunk.type === 'error') {
            logAgentChatFailure(ctx.env, 'admin chat stream error', chunk.error, {
              artifactId: ctx.artifactId,
              mode: 'admin',
              conversationId,
              upstreamError: chunk.error,
            });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              error: userFacingAgentStreamError(chunk.error),
            })}\n\n`));
            await recordError(ctx.env, ctx.artifactId, 'admin');
          }
        }

        // Parse any edit suggestions from the response
        const suggestedEdits = parseEditSuggestions(fullContent);

        // Save assistant message
        const assistantMsgId = generateId('msg');
        await ctx.env.DB.prepare(`
          INSERT INTO agent_messages (id, thread_id, role, content, suggested_edits, input_tokens, output_tokens, model, created_at)
          VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        `).bind(
          assistantMsgId,
          conversationId,
          fullContent,
          suggestedEdits.length > 0 ? JSON.stringify(suggestedEdits) : null,
          inputTokens,
          outputTokens,
          model
        ).run();

        // Update conversation
        await ctx.env.DB.prepare(`
          UPDATE agent_threads
          SET message_count = message_count + 2,
              total_input_tokens = total_input_tokens + ?,
              total_output_tokens = total_output_tokens + ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ?
        `).bind(inputTokens, outputTokens, conversationId).run();

        // Record usage
        await recordUsage(ctx.env, ctx.artifactId, 'admin', inputTokens, outputTokens);
        await recordAgentUsage(ctx.env, {
          workspaceId: ai.workspaceId,
          artifactId: ctx.artifactId,
          conversationId,
          mode: 'admin',
          provider: aiConfig.provider,
          model: aiConfig.model,
          inputTokens,
          outputTokens,
          byo: ai.byo,
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'done',
          conversationId,
          suggestedEdits: suggestedEdits.length > 0 ? suggestedEdits : undefined,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        })}\n\n`));
        controller.close();
      } catch (error) {
        logAgentChatFailure(ctx.env, 'admin chat failed', error, {
          artifactId: ctx.artifactId,
          mode: 'admin',
          conversationId,
        });
        await recordError(ctx.env, ctx.artifactId, 'admin');
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          error: userFacingAgentChatFailure(error),
        })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': ctx.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

export function parseEditSuggestions(content: string): EditSuggestion[] {
  const suggestions: EditSuggestion[] = [];

  // Parse diff blocks
  const diffRegex = /```diff\n([\s\S]*?)```/g;
  let match;

  while ((match = diffRegex.exec(content)) !== null) {
    const diffContent = match[1];
    const lines = diffContent.split('\n');

    let currentFile: string | null = null;
    let searchLines: string[] = [];
    let replaceLines: string[] = [];

    for (const line of lines) {
      // Check for file header
      if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        const filePath = line.slice(4).trim().replace(/^[ab]\//, '');
        if (filePath && filePath !== '/dev/null') {
          currentFile = filePath;
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        searchLines.push(line.slice(1));
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        replaceLines.push(line.slice(1));
      } else if (!line.startsWith('@')) {
        // Context line
        searchLines.push(line.startsWith(' ') ? line.slice(1) : line);
        replaceLines.push(line.startsWith(' ') ? line.slice(1) : line);
      }
    }

    if (currentFile && (searchLines.length > 0 || replaceLines.length > 0)) {
      suggestions.push({
        file: currentFile,
        type: 'replace',
        search: searchLines.join('\n'),
        replace: replaceLines.join('\n'),
      });
    }
  }

  // Also look for explicit file paths mentioned with code blocks
  const fileCodeRegex = /(?:file|path):\s*[`"]?([^\s`"]+)[`"]?\s*\n```\w*\n([\s\S]*?)```/gi;

  while ((match = fileCodeRegex.exec(content)) !== null) {
    const file = match[1];
    const newContent = match[2];

    // Check if this is a replacement (contains old/new markers)
    if (!suggestions.find(s => s.file === file)) {
      suggestions.push({
        file,
        type: 'replace',
        replace: newContent,
      });
    }
  }

  return suggestions;
}

export async function handleApplyEdits(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
  }

  let body: ApplyEditsRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' }, ctx.origin);
  }

  if (!body.edits || !Array.isArray(body.edits) || body.edits.length === 0) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'edits array is required' }, ctx.origin);
  }

  // Preserve the HTTP handler's 404 when the artifact has no version to edit.
  const latestVersion = await ctx.env.DB.prepare(
    'SELECT id FROM versions WHERE artifact_id = ? ORDER BY version_no DESC LIMIT 1'
  ).bind(ctx.artifactId).first<{ id: string }>();
  if (!latestVersion) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'No versions found' }, ctx.origin);
  }

  const applied = await applyEditsToPending(ctx, body.conversationId, body.edits);
  return successResponse({ applied }, 200, ctx.origin);
}

/**
 * Stage a set of suggested edits as pending edits for a conversation. Resolves
 * each file's current content from the latest version (for search/replace), then
 * inserts an artifact_pending_edits row. Shared by the HTTP apply handler and
 * headless callers. Returns a per-file applied/failed report.
 */
export async function applyEditsToPending(
  ctx: DataContext,
  conversationId: string,
  edits: EditSuggestion[]
): Promise<Array<{ file: string; success: boolean; error?: string }>> {
  const latestVersion = await ctx.env.DB.prepare(`
    SELECT id FROM versions WHERE artifact_id = ? ORDER BY version_no DESC LIMIT 1
  `).bind(ctx.artifactId).first<{ id: string }>();

  const applied: Array<{ file: string; success: boolean; error?: string }> = [];
  if (!latestVersion) {
    for (const edit of edits) applied.push({ file: edit.file, success: false, error: 'No versions found' });
    return applied;
  }

  for (const edit of edits) {
    try {
      const asset = await ctx.env.DB.prepare(`
        SELECT r2_key, mime FROM assets WHERE version_id = ? AND path = ?
      `).bind(latestVersion.id, edit.file).first<{ r2_key: string; mime: string }>();

      let originalContent = '';
      if (asset) {
        const obj = await ctx.env.ARTIFACTS.get(asset.r2_key);
        if (obj) originalContent = await obj.text();
      }

      let newContent: string;
      if (edit.type === 'replace' && edit.search && edit.replace !== undefined) {
        if (!originalContent.includes(edit.search)) {
          applied.push({ file: edit.file, success: false, error: 'Search text not found' });
          continue;
        }
        newContent = originalContent.replace(edit.search, edit.replace);
      } else if (edit.replace !== undefined) {
        newContent = edit.replace;
      } else {
        applied.push({ file: edit.file, success: false, error: 'Invalid edit type' });
        continue;
      }

      const pendingId = generateId('ped');
      await ctx.env.DB.prepare(`
        INSERT INTO artifact_pending_edits (id, artifact_id, thread_id, file_path, original_content, new_content, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      `).bind(pendingId, ctx.artifactId, conversationId, edit.file, originalContent, newContent).run();

      applied.push({ file: edit.file, success: true });
    } catch (error) {
      logAgentChatFailure(ctx.env, 'apply edit failed', error, {
        artifactId: ctx.artifactId,
        mode: 'admin',
        conversationId,
      });
      applied.push({ file: edit.file, success: false, error: userFacingApplyEditError(error) });
    }
  }

  return applied;
}

export type PublishResult =
  | { ok: true; versionId: string; versionNo: number; url: string | null; appliedEdits: number }
  | { ok: false; error: string };

/**
 * Promote a conversation's pending edits to a new published version. Shared by
 * the HTTP publish handler and headless callers (e.g. the Telegram bot). Creates
 * a new version, uploads edited files to R2, copies unchanged assets, and points
 * the production deployment at it.
 */
export async function publishConversation(
  ctx: DataContext,
  conversationId: string,
  commitMessage?: string
): Promise<PublishResult> {
  const pendingEdits = await ctx.env.DB.prepare(`
    SELECT * FROM artifact_pending_edits
    WHERE artifact_id = ? AND thread_id = ? AND status = 'pending'
  `).bind(ctx.artifactId, conversationId).all<PendingEdit>();

  if (pendingEdits.results.length === 0) {
    return { ok: false, error: 'No pending edits found' };
  }

  const artifact = await ctx.env.DB.prepare(
    'SELECT id FROM artifacts WHERE id = ?'
  ).bind(ctx.artifactId).first<{ id: string }>();
  if (!artifact) {
    return { ok: false, error: 'Artifact not found' };
  }

  const latestVersion = await ctx.env.DB.prepare(`
    SELECT id, version_no FROM versions
    WHERE artifact_id = ?
    ORDER BY version_no DESC
    LIMIT 1
  `).bind(ctx.artifactId).first<{ id: string; version_no: number }>();

  if (!latestVersion) {
    return { ok: false, error: 'No versions found' };
  }

  const currentAssets = await ctx.env.DB.prepare(`
    SELECT path, r2_key, mime, size_bytes, sha256 FROM assets WHERE version_id = ?
  `).bind(latestVersion.id).all();

  const editMap = new Map<string, PendingEdit>();
  for (const edit of pendingEdits.results) {
    editMap.set(edit.file_path, edit);
  }

  const newVersionId = generateId('ver');
  const newVersionNo = latestVersion.version_no + 1;

  await ctx.env.DB.prepare(`
    INSERT INTO versions (id, artifact_id, version_no, message, created_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).bind(
    newVersionId,
    ctx.artifactId,
    newVersionNo,
    commitMessage || `AI-assisted edit from conversation ${conversationId}`
  ).run();

  for (const asset of currentAssets.results as Array<{
    path: string;
    r2_key: string;
    mime: string;
    size_bytes: number;
    sha256: string;
  }>) {
    const edit = editMap.get(asset.path);

    if (edit && edit.new_content) {
      const content = edit.new_content;
      const contentBytes = new TextEncoder().encode(content);
      const hashBuffer = await crypto.subtle.digest('SHA-256', contentBytes);
      const sha256 = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const newR2Key = `artifacts/${ctx.artifactId}/${newVersionId}/${asset.path}`;

      await ctx.env.ARTIFACTS.put(newR2Key, content, {
        httpMetadata: { contentType: asset.mime },
      });

      const newAssetId = generateId('ast');
      await ctx.env.DB.prepare(`
        INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(newAssetId, newVersionId, asset.path, newR2Key, asset.mime, contentBytes.length, sha256).run();

      await ctx.env.DB.prepare(`
        UPDATE artifact_pending_edits SET status = 'applied', applied_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?
      `).bind(edit.id).run();
    } else {
      const newAssetId = generateId('ast');
      await ctx.env.DB.prepare(`
        INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(newAssetId, newVersionId, asset.path, asset.r2_key, asset.mime, asset.size_bytes, asset.sha256).run();
    }
  }

  await ctx.env.DB.prepare(`
    UPDATE deployments SET version_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE artifact_id = ? AND channel = 'production'
  `).bind(newVersionId, ctx.artifactId).run();

  const deployment = await ctx.env.DB.prepare(`
    SELECT slug FROM deployments WHERE artifact_id = ? AND channel = 'production'
  `).bind(ctx.artifactId).first<{ slug: string }>();

  return {
    ok: true,
    versionId: newVersionId,
    versionNo: newVersionNo,
    url: deployment ? `${ctx.env.SHAREOUT_BASE_URL}/a/${deployment.slug}` : null,
    appliedEdits: pendingEdits.results.length,
  };
}

export async function handlePublish(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
  }

  let body: { conversationId: string; commitMessage?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' }, ctx.origin);
  }

  if (!body.conversationId) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'conversationId is required' }, ctx.origin);
  }

  const result = await publishConversation(ctx, body.conversationId, body.commitMessage);
  if (!result.ok) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: result.error }, ctx.origin);
  }

  return successResponse({
    version: { id: result.versionId, version_no: result.versionNo },
    url: result.url,
    appliedEdits: result.appliedEdits,
  }, 200, ctx.origin);
}
