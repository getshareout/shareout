/**
 * ShareOut Visual Editor — AI chat entry point.
 *
 * Routes `/editor/chat/{mode}` to focused handlers. Submodules own prompts,
 * streaming, conversation memory, and response parsing; this file wires HTTP only.
 *
 * @module editor/chat
 */

import type { EditorContext } from '../index';
import type { ChatMode } from '../types';
import { isArtifactFeatureEnabled } from '../../features/flags';
import { debugLog } from './config';
import { errorResponse } from './errors';
import {
  handleApplyChanges,
  handleInlineChat,
  handleLassoChat,
  handleNormalChat,
  handleRejectChanges,
} from './handlers';

export { buildEditorSystemPrompt } from './prompts';
export { loadConversationHistory, storeConversationTurn } from './history';
export { parseAgentResponse } from './parse-response';

/** Dispatch editor chat requests by mode (`normal`, `inline`, `lasso`, `apply`, `reject`). */
export async function handleEditorChat(
  request: Request,
  ctx: EditorContext,
  path: string
): Promise<Response> {
  const method = request.method;
  const parts = path.split('/').filter(Boolean);
  const mode = parts[0] as ChatMode | undefined;

  debugLog('ROUTE', `${method} /editor/chat/${path}`, {
    artifactId: ctx.artifactId,
    userId: ctx.userId,
    mode,
  });

  if (method !== 'POST') {
    debugLog('ROUTE', 'Method not allowed');
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  }

  if (!(await isArtifactFeatureEnabled(ctx.env, 'ai.editor_chat', ctx.artifactId))) {
    return errorResponse('FEATURE_DISABLED', 'Editor AI is disabled for this workspace', 403);
  }

  switch (mode) {
    case 'normal':
      return handleNormalChat(request, ctx);
    case 'inline':
      return handleInlineChat(request, ctx);
    case 'lasso':
      return handleLassoChat(request, ctx);
    case 'apply':
      return handleApplyChanges(request, ctx);
    case 'reject':
      return handleRejectChanges(request, ctx);
    default:
      debugLog('ROUTE', 'Invalid mode', { mode });
      return errorResponse('INVALID_MODE', 'Invalid chat mode', 400);
  }
}
