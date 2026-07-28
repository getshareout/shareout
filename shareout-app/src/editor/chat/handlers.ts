/**
 * Per-mode HTTP handlers for `/editor/chat/{mode}`.
 */

import type { EditorContext } from '../index';
import type { EditorChatRequest } from '../types';
import { debugError, debugLog } from './config';
import { errorResponse, parseJsonBody } from './errors';
import { loadConversationHistory } from './history';
import {
  buildEditorSystemPrompt,
  buildInlineSystemPrompt,
  buildLassoSystemPrompt,
} from './prompts';
import { createStreamingResponse, createVisionStreamingResponse } from './streaming';

export async function handleNormalChat(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, userId, env } = ctx;

  try {
    const bodyOrError = await parseJsonBody<EditorChatRequest>(request);
    if (bodyOrError instanceof Response) return bodyOrError;
    const body = bodyOrError;

    debugLog('NORMAL', 'Received request', {
      promptLength: body.prompt?.length,
      hasArtifact: !!body.context?.artifact,
      artifactName: body.context?.artifact?.name,
      hasSelection: !!body.context?.selection,
      selectionSelector: body.context?.selection?.selector,
      htmlMode: body.context?.htmlMode,
      htmlLength: body.context?.documentHtml?.length,
      outlineNodes: body.context?.outline?.nodes?.length,
    });

    if (!body.prompt) {
      debugLog('NORMAL', 'Missing prompt');
      return errorResponse('INVALID_REQUEST', 'prompt required', 400);
    }

    const systemPrompt = buildEditorSystemPrompt(body.context);
    const history = await loadConversationHistory(env, artifactId, userId);
    const messages = [...history, { role: 'user' as const, content: body.prompt }];

    debugLog('NORMAL', 'Built system prompt', {
      historyTurns: history.length,
      systemPromptLength: systemPrompt.length,
      userMessage: body.prompt.slice(0, 100),
    });

    return createStreamingResponse(env, messages, systemPrompt, artifactId, userId, 'normal');
  } catch (error) {
    debugError('NORMAL', 'Chat failed', error);
    return errorResponse('INTERNAL_ERROR', 'Chat failed', 500);
  }
}

export async function handleInlineChat(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, userId, env } = ctx;

  try {
    const bodyOrError = await parseJsonBody<EditorChatRequest>(request);
    if (bodyOrError instanceof Response) return bodyOrError;
    const body = bodyOrError;

    if (!body.prompt || !body.context.inlineSelection) {
      return errorResponse('INVALID_REQUEST', 'prompt and inlineSelection required', 400);
    }

    const systemPrompt = buildInlineSystemPrompt(body.context);
    const messages = [{ role: 'user' as const, content: body.prompt }];

    return createStreamingResponse(env, messages, systemPrompt, artifactId, userId, 'inline');
  } catch (error) {
    debugError('INLINE', 'Chat failed', error);
    return errorResponse('INTERNAL_ERROR', 'Chat failed', 500);
  }
}

export async function handleLassoChat(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, userId, env } = ctx;

  try {
    const bodyOrError = await parseJsonBody<EditorChatRequest>(request);
    if (bodyOrError instanceof Response) return bodyOrError;
    const body = bodyOrError;

    debugLog('LASSO', 'Received request', {
      promptLength: body.prompt?.length,
      hasLassoImage: !!body.context?.lassoImage,
      lassoImageSize: body.context?.lassoImage ? `${Math.round(body.context.lassoImage.length / 1024)}KB` : null,
      lassoElementsCount: body.context?.lassoElementsCount,
      lassoElementsHtmlLength: body.context?.lassoElementsHtml?.length,
      lassoBounds: body.context?.lassoBounds,
      hasArtifact: !!body.context?.artifact,
      outlineNodes: body.context?.outline?.nodes?.length,
      htmlLength: body.context?.documentHtml?.length,
    });

    if (!body.prompt || !body.context.lassoImage) {
      debugLog('LASSO', 'Missing prompt or lassoImage');
      return errorResponse('INVALID_REQUEST', 'prompt and lassoImage required', 400);
    }

    const systemPrompt = buildLassoSystemPrompt(body.context);

    debugLog('LASSO', 'Built system prompt', {
      systemPromptLength: systemPrompt.length,
      userMessage: body.prompt.slice(0, 100),
    });

    return createVisionStreamingResponse(
      env,
      body.prompt,
      body.context.lassoImage,
      systemPrompt,
      artifactId,
      userId
    );
  } catch (error) {
    debugError('LASSO', 'Chat failed', error);
    return errorResponse('INTERNAL_ERROR', 'Chat failed', 500);
  }
}

export async function handleApplyChanges(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, userId, env } = ctx;

  try {
    const bodyOrError = await parseJsonBody<{ changeId: string }>(request);
    if (bodyOrError instanceof Response) return bodyOrError;
    const body = bodyOrError;

    if (!body.changeId) {
      return errorResponse('INVALID_REQUEST', 'changeId required', 400);
    }

    await env.DB.prepare(`
      UPDATE editor_pending_changes
      SET status = 'applied', resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND artifact_id = ? AND user_id = ?
    `).bind(body.changeId, artifactId, userId).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Changes applied',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    debugError('APPLY', 'Failed to apply changes', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to apply changes', 500);
  }
}

export async function handleRejectChanges(
  request: Request,
  ctx: EditorContext
): Promise<Response> {
  const { artifactId, userId, env } = ctx;

  try {
    const bodyOrError = await parseJsonBody<{ changeId: string }>(request);
    if (bodyOrError instanceof Response) return bodyOrError;
    const body = bodyOrError;

    if (!body.changeId) {
      return errorResponse('INVALID_REQUEST', 'changeId required', 400);
    }

    await env.DB.prepare(`
      UPDATE editor_pending_changes
      SET status = 'rejected', resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND artifact_id = ? AND user_id = ?
    `).bind(body.changeId, artifactId, userId).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Changes rejected',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    debugError('REJECT', 'Failed to reject changes', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to reject changes', 500);
  }
}
