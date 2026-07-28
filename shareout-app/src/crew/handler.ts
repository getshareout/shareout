import { DATA_ERRORS } from '../types';
import type { DataContext } from '../data/middleware';
import { errorResponse, successResponse, verifyOwner, corsHeaders } from '../data/middleware';
import {
  defineCrew,
  getCrew,
  createRun,
  listRuns,
  getRun,
  getRunEvents,
  listTriggers,
  createTrigger,
  updateTrigger,
  deleteTrigger,
  type DefineCrewBody,
  type CreateTriggerBody,
} from './store';
import { runCrew } from './run-loop';
import { resolveCrewLimits, countActiveRuns } from './limits';
import { listApprovals, getApproval, approveAndExecute, rejectApproval } from './approvals';

function methodNotAllowed(ctx: DataContext): Response {
  return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
}

function sseHeaders(ctx: DataContext): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    ...corsHeaders(ctx.origin),
  };
}

export async function handleCrew(request: Request, ctx: DataContext, path: string): Promise<Response> {
  const parts = path.split('/').filter(Boolean);

  // All Crew endpoints are owner-only in Phase 0 (a crew acts with owner scope).
  if (!(await verifyOwner(request, ctx))) {
    return errorResponse(DATA_ERRORS.FORBIDDEN, ctx.origin);
  }

  // GET /crew  → crew config + grants
  if (parts.length === 0) {
    if (request.method !== 'GET') return methodNotAllowed(ctx);
    return getCrewConfig(ctx);
  }

  if (parts[0] === 'define' && parts.length === 1) {
    if (request.method !== 'POST') return methodNotAllowed(ctx);
    return handleDefine(request, ctx);
  }

  if (parts[0] === 'run' && parts.length === 1) {
    if (request.method !== 'POST') return methodNotAllowed(ctx);
    return handleRun(request, ctx);
  }

  if (parts[0] === 'runs') {
    if (parts.length === 1) {
      if (request.method !== 'GET') return methodNotAllowed(ctx);
      return handleListRuns(ctx);
    }
    const runId = parts[1];
    if (parts.length === 2 && request.method === 'GET') return handleGetRun(ctx, runId);
    if (parts.length === 3 && parts[2] === 'stream' && request.method === 'GET') {
      return handleStream(ctx, runId);
    }
  }

  if (parts[0] === 'triggers') {
    if (parts.length === 1) {
      if (request.method === 'GET') return handleListTriggers(ctx);
      if (request.method === 'POST') return handleCreateTrigger(request, ctx);
      return methodNotAllowed(ctx);
    }
    const triggerId = parts[1];
    if (parts.length === 2 && (request.method === 'PATCH' || request.method === 'PUT')) {
      return handleUpdateTrigger(request, ctx, triggerId);
    }
    if (parts.length === 2 && request.method === 'DELETE') {
      return handleDeleteTrigger(ctx, triggerId);
    }
  }

  if (parts[0] === 'approvals') {
    if (parts.length === 1 && request.method === 'GET') return handleListApprovals(request, ctx);
    const approvalId = parts[1];
    if (parts.length === 3 && parts[2] === 'approve' && request.method === 'POST') {
      return handleApprove(ctx, approvalId);
    }
    if (parts.length === 3 && parts[2] === 'reject' && request.method === 'POST') {
      return handleReject(ctx, approvalId);
    }
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
}

async function resolveOwnerId(ctx: DataContext): Promise<string | null> {
  const r = await ctx.env.DB.prepare('SELECT owner_id FROM artifacts WHERE id = ?')
    .bind(ctx.artifactId)
    .first<{ owner_id: string | null }>();
  return r?.owner_id ?? null;
}

async function handleListApprovals(request: Request, ctx: DataContext): Promise<Response> {
  const status = new URL(request.url).searchParams.get('status') || undefined;
  const approvals = await listApprovals(ctx.env, ctx.artifactId, status);
  return successResponse({ approvals }, 200, ctx.origin);
}

async function handleApprove(ctx: DataContext, approvalId: string): Promise<Response> {
  const appr = await getApproval(ctx.env, approvalId);
  if (!appr || appr.artifact_id !== ctx.artifactId) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  const ownerId = await resolveOwnerId(ctx);
  const res = await approveAndExecute(ctx.env, approvalId, ownerId);
  if (res.status === 'noop') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: res.error || 'Approval is not pending' }, ctx.origin);
  }
  return successResponse({ status: res.status, result: res.result, error: res.error }, 200, ctx.origin);
}

async function handleReject(ctx: DataContext, approvalId: string): Promise<Response> {
  const appr = await getApproval(ctx.env, approvalId);
  if (!appr || appr.artifact_id !== ctx.artifactId) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  const ownerId = await resolveOwnerId(ctx);
  const ok = await rejectApproval(ctx.env, approvalId, ownerId);
  if (!ok) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Approval is not pending' }, ctx.origin);
  }
  return successResponse({ rejected: true }, 200, ctx.origin);
}

async function getCrewConfig(ctx: DataContext): Promise<Response> {
  const crew = await getCrew(ctx.env, ctx.artifactId);
  if (!crew) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'No crew defined for this artifact' }, ctx.origin);
  }
  const grants = await ctx.env.DB.prepare(
    'SELECT tool_name, mode, enabled, approval_policy, limits_json FROM crew_grants WHERE crew_id = ?'
  )
    .bind(crew.id)
    .all();
  return successResponse({ crew, grants: grants.results }, 200, ctx.origin);
}

async function handleDefine(request: Request, ctx: DataContext): Promise<Response> {
  let body: DefineCrewBody;
  try {
    body = (await request.json()) as DefineCrewBody;
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }
  const crew = await defineCrew(ctx.env, ctx.artifactId, ctx.workspaceId, body);
  return successResponse({ crew }, 200, ctx.origin);
}

async function handleRun(request: Request, ctx: DataContext): Promise<Response> {
  let body: { input?: string } = {};
  try {
    body = (await request.json()) as { input?: string };
  } catch {
    /* empty body is allowed */
  }

  const crew = await getCrew(ctx.env, ctx.artifactId);
  if (!crew) {
    return errorResponse(
      { ...DATA_ERRORS.NOT_FOUND, message: 'No crew defined. Call POST /crew/define first.' },
      ctx.origin
    );
  }
  if (crew.status !== 'active') {
    return errorResponse({ ...DATA_ERRORS.FORBIDDEN, message: `Crew is ${crew.status}` }, ctx.origin);
  }

  // Per-tenant concurrency gate (plan tier).
  const limits = await resolveCrewLimits(ctx.env, crew.owner_id);
  if ((await countActiveRuns(ctx.env, crew.owner_id)) >= limits.max_concurrent_runs) {
    return errorResponse(
      {
        code: 'CONCURRENCY_LIMIT',
        message: `Too many concurrent crew runs (plan limit: ${limits.max_concurrent_runs}). Try again when one finishes.`,
        status: 429,
      },
      ctx.origin
    );
  }

  const input = typeof body.input === 'string' ? body.input : '';
  const run = await createRun(ctx.env, crew, input, crew.owner_id);
  const stream = runCrew({ env: ctx.env, crew, run, ownerCtx: ctx, input });
  return new Response(stream, { headers: sseHeaders(ctx) });
}

async function handleListRuns(ctx: DataContext): Promise<Response> {
  const crew = await getCrew(ctx.env, ctx.artifactId);
  if (!crew) return successResponse({ runs: [] }, 200, ctx.origin);
  const runs = await listRuns(ctx.env, crew.id);
  return successResponse({ runs }, 200, ctx.origin);
}

async function handleGetRun(ctx: DataContext, runId: string): Promise<Response> {
  const run = await getRun(ctx.env, runId);
  if (!run || run.artifact_id !== ctx.artifactId) {
    return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  }
  const events = await getRunEvents(ctx.env, runId);
  return successResponse({ run, events }, 200, ctx.origin);
}

async function handleListTriggers(ctx: DataContext): Promise<Response> {
  const crew = await getCrew(ctx.env, ctx.artifactId);
  if (!crew) return successResponse({ triggers: [] }, 200, ctx.origin);
  const triggers = await listTriggers(ctx.env, crew.id);
  return successResponse({ triggers }, 200, ctx.origin);
}

async function handleCreateTrigger(request: Request, ctx: DataContext): Promise<Response> {
  const crew = await getCrew(ctx.env, ctx.artifactId);
  if (!crew) {
    return errorResponse(
      { ...DATA_ERRORS.NOT_FOUND, message: 'No crew defined. Call POST /crew/define first.' },
      ctx.origin
    );
  }
  let body: CreateTriggerBody;
  try {
    body = (await request.json()) as CreateTriggerBody;
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }
  const result = await createTrigger(ctx.env, crew, body);
  if ('error' in result) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: result.error }, ctx.origin);
  }
  return successResponse({ trigger: result }, 200, ctx.origin);
}

async function handleUpdateTrigger(request: Request, ctx: DataContext, triggerId: string): Promise<Response> {
  const crew = await getCrew(ctx.env, ctx.artifactId);
  if (!crew) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  let body: { enabled?: boolean; cron?: string; eventType?: string };
  try {
    body = (await request.json()) as { enabled?: boolean; cron?: string; eventType?: string };
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }
  const result = await updateTrigger(ctx.env, crew.id, triggerId, body);
  if ('error' in result) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: result.error }, ctx.origin);
  }
  return successResponse({ trigger: result }, 200, ctx.origin);
}

async function handleDeleteTrigger(ctx: DataContext, triggerId: string): Promise<Response> {
  const crew = await getCrew(ctx.env, ctx.artifactId);
  if (!crew) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  const ok = await deleteTrigger(ctx.env, crew.id, triggerId);
  if (!ok) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  return successResponse({ deleted: true }, 200, ctx.origin);
}

async function handleStream(ctx: DataContext, runId: string): Promise<Response> {
  const run = await getRun(ctx.env, runId);
  if (!run || run.artifact_id !== ctx.artifactId) {
    return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
  }
  const events = await getRunEvents(ctx.env, runId);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', runId })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: sseHeaders(ctx) });
}
