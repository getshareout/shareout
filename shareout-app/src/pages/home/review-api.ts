/**
 * /v1/home review endpoints for the Inspector: review state, resolve, assign, approve.
 */
import type { Env } from '../../types';
import { apiErrorResponse } from '../../http/api-error';
import { queryReviewState, setApproval, setCommentAssignee, setCommentResolved, type ReviewResult } from './queries/review';

type User = { id: string; email: string | null; name?: string | null };

function respond<T>(r: ReviewResult<T>): Response {
  return r.ok ? Response.json(r.data) : apiErrorResponse({ code: r.code, message: r.message, status: r.status });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {};
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const missing = (param: string) => apiErrorResponse({ code: 'VALIDATION_ERROR', message: `${param} required`, status: 400, param });

/** GET /v1/home/review?artifactId= — live version, can_review, approvals. */
export async function handleHomeReviewGetApi(request: Request, env: Env, user: User): Promise<Response> {
  const artifactId = str(new URL(request.url).searchParams.get('artifactId'));
  if (!artifactId) return missing('artifactId');
  const state = await queryReviewState(env, user, artifactId);
  if (!state) return apiErrorResponse({ code: 'FORBIDDEN', message: 'No access to this artifact', status: 403 });
  return Response.json(state);
}

/** POST /v1/home/comments/resolve — { artifactId, commentId, resolved }. */
export async function handleHomeCommentResolveApi(request: Request, env: Env, user: User): Promise<Response> {
  const b = await readBody(request);
  const artifactId = str(b.artifactId), commentId = str(b.commentId);
  if (!artifactId) return missing('artifactId');
  if (!commentId) return missing('commentId');
  return respond(await setCommentResolved(env, user, artifactId, commentId, b.resolved !== false));
}

/** POST /v1/home/comments/assign — { artifactId, commentId, assignee: email | null }. */
export async function handleHomeCommentAssignApi(request: Request, env: Env, user: User): Promise<Response> {
  const b = await readBody(request);
  const artifactId = str(b.artifactId), commentId = str(b.commentId);
  if (!artifactId) return missing('artifactId');
  if (!commentId) return missing('commentId');
  return respond(await setCommentAssignee(env, user, artifactId, commentId, str(b.assignee)));
}

/** POST /v1/home/approvals — { artifactId, versionId?, approved? } (live version by default). */
export async function handleHomeApprovalApi(request: Request, env: Env, user: User): Promise<Response> {
  const b = await readBody(request);
  const artifactId = str(b.artifactId);
  if (!artifactId) return missing('artifactId');
  return respond(await setApproval(env, user, artifactId, str(b.versionId), b.approved !== false));
}
