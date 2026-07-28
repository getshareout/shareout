/**
 * Artifact comments HTTP router — thin dispatcher over focused modules.
 *
 * Module layout (`src/data/comments/`):
 * - `types.ts` — shared types and constants
 * - `mapping.ts` — D1 row ↔ API shape conversion, reply depth
 * - `config.ts` — per-artifact comments configuration
 * - `auth.ts` — session resolution and identity validation
 * - `people.ts` — assignable people list and assignee resolution
 * - `reactions.ts` — emoji reactions
 * - `unread.ts` — read/unread tracking
 * - `broadcast.ts` — WebSocket proxy and DO broadcast
 * - `crud.ts` — list, create, read, edit, delete
 * - `actions.ts` — resolve and assign (action items)
 * - `file-comments.ts` — per-file gate on asset-bucket artifacts
 * - `tool.ts` — programmatic create for Crew tools
 */
import { errorResponse, type DataContext } from '../middleware';
import { COMMENT_ID_PATTERN } from './types';
import { getConfig, handleConfig } from './config';
import { handlePeople } from './people';
import { handleUnread, handleMarkRead } from './unread';
import { handleWebSocket } from './broadcast';
import { isAssetBucketArtifact, authorizeFileCommentById } from './file-comments';
import {
  listComments,
  addComment,
  getComment,
  getReplies,
  editComment,
  deleteComment,
} from './crud';
import { resolveComment, assignComment } from './actions';
import { reactComment } from './reactions';

export { createCommentForTool } from './tool';

export async function handleComments(
  request: Request,
  ctx: DataContext,
  path: string,
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const firstPart = parts[0];
  const secondPart = parts[1];

  if (firstPart === '_config') {
    return handleConfig(request, ctx);
  }

  if (firstPart === '_people') {
    return handlePeople(request, ctx);
  }

  if (firstPart === '_unread') {
    return handleUnread(request, ctx);
  }

  if (firstPart === '_read') {
    return handleMarkRead(request, ctx);
  }

  if (firstPart === 'ws') {
    // File comments (work/042 P2) have no realtime channel: the DO stream bypasses the
    // per-file read gate, so gating REST while streaming the same thread would be a hole.
    // The lens refetches on open instead. Block the socket on bucket artifacts.
    if (await isAssetBucketArtifact(ctx)) {
      return errorResponse({ code: 'REALTIME_UNAVAILABLE', message: 'Realtime comments are not available for files.', status: 403 });
    }
    return handleWebSocket(request, ctx);
  }

  const config = await getConfig(ctx);
  if (!config.enabled) {
    return errorResponse({ code: 'COMMENTS_DISABLED', message: 'Comments are disabled', status: 403 });
  }

  if (!firstPart) {
    switch (request.method) {
      case 'GET':
        return listComments(request, ctx);
      case 'POST':
        return addComment(request, ctx, config);
      default:
        return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
    }
  }

  if (!COMMENT_ID_PATTERN.test(firstPart)) {
    return errorResponse({ code: 'INVALID_ID', message: 'Invalid comment ID', status: 400 });
  }

  const commentId = firstPart;

  // On a bucket, id-keyed mutations must pass the file gate so a signed-in stranger cannot
  // act on a private file's thread. list/create/get/replies are gated inside crud.
  // edit/delete → view; resolve/assign/reactions → comment.
  const isIdMutation =
    (!secondPart && (request.method === 'PATCH' || request.method === 'DELETE')) ||
    secondPart === 'resolve' ||
    secondPart === 'assign' ||
    secondPart === 'reactions';
  if (isIdMutation && (await isAssetBucketArtifact(ctx))) {
    const cap =
      secondPart === 'resolve' || secondPart === 'assign' || secondPart === 'reactions'
        ? 'comment'
        : 'view';
    const gate = await authorizeFileCommentById(request, ctx, commentId, cap);
    if (gate) return gate;
  }

  if (secondPart === 'replies') {
    return getReplies(request, ctx, commentId);
  }

  if (secondPart === 'resolve') {
    return resolveComment(request, ctx, commentId);
  }

  if (secondPart === 'assign') {
    return assignComment(request, ctx, commentId);
  }

  if (secondPart === 'reactions') {
    return reactComment(request, ctx, commentId);
  }

  switch (request.method) {
    case 'GET':
      return getComment(request, ctx, commentId);
    case 'PATCH':
      return editComment(request, ctx, commentId);
    case 'DELETE':
      return deleteComment(request, ctx, commentId);
    default:
      return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }
}
