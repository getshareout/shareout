import type { Env } from '../types';
import { DATA_ERRORS } from '../types';
import { dataMiddleware, handleCorsOptions, errorResponse, successResponse, setRequestOrigin, type DataContext } from './middleware';
import { handleJsonStore } from './json-store';
import { handleTables } from './tables';
import { handleProvision } from './provision';
import { handleWorkspaceData } from './workspace-shared';
import { handleDatasets, handleDatasetUpload } from './datasets/handler';
import { handleConnections } from './connections/handler';
import { handleSecrets } from './secrets/handler';
import { handleRealtime } from './realtime';
import { handleComments } from './comments/handler';
import { handleSheets } from './sheets/handler';
import { handleBlobs, handleBlobUpload } from './blobs/handler';
import { handleGitHub } from './github/handler';
import { handleAgent } from './agent/handler';
import { handlePilotSpike } from './agent/pilot';
import { isLocalRequest } from '../router/helpers/is-local-request';
import { handleCrew } from '../crew/handler';
import { handleSlides } from './slides/handler';
import { handleProxy, handleProxyConfig } from '../proxy';
import { handleEmail } from './email/handler';
import { handleInbox } from './inbox/handler';
import { handlePlatformRequest } from './platform';
import { isFeatureEnabled, featureDisabledResponse } from '../features/flags';
import { createLogger, logError } from '../logging';

// Data tier -> feature key. Tiers absent here (json, tables, datasets, secrets,
// batch) are core data plumbing and are never gated.
const TIER_FEATURE: Record<string, string> = {
  connections: 'integ.connections',
  realtime: 'collab.realtime',
  comments: 'collab.comments',
  sheets: 'integ.data_platform',
  github: 'integ.github',
  blobs: 'module.blobs',
  agent: 'ai.visitor_chat',
  crew: 'ai.crew',
  slides: 'module.slides',
  proxy: 'integ.cors_proxy',
  email: 'dest.email',
  inbox: 'dest.email',
  platform: 'integ.data_platform',
};

// HTTP methods that mutate state.
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Tiers backing the artifact's OWN private stores, which had NO write auth and
// so accepted anonymous writes on a public artifact (the hole closed by
// Workstream A). Anonymous mutations here require the owner's per-artifact
// opt-in (ctx.canWrite). NOT listed: comments (anonymous-by-design via its own
// identityMode config), workspace shared-tables / sheets / platform / secrets /
// connections (own membership/owner auth), realtime (gated separately below).
export const ANON_WRITE_GATED_TIERS = new Set(['json', 'tables', 'blobs', 'datasets']);

// Pure read-only-default decision (Workstream A), enumerable in tests. `canWrite`
// is undefined only for trusted internal contexts, which never reach the HTTP
// router, so treat undefined as deny here.
export function shouldBlockAnonWrite(tier: string, method: string, canWrite: boolean | undefined): boolean {
  return ANON_WRITE_GATED_TIERS.has(tier) && MUTATING_METHODS.has(method.toUpperCase()) && canWrite !== true;
}

// Read-only-default gate: block anonymous mutations to the artifact's private
// stores unless the owner opted in. Returns an error Response to send, or null.
function anonWriteDenied(tier: string, method: string, ctx: DataContext, origin: string | null): Response | null {
  if (shouldBlockAnonWrite(tier, method, ctx.canWrite)) {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      message: 'This public artifact is read-only for anonymous visitors.',
      hint: 'The artifact owner can enable anonymous writes for this artifact.',
      suggestion: 'Set allow_anon_write on the artifact, or sign in as the owner.',
    }, origin);
  }
  return null;
}

interface BatchRequest {
  requests: Array<{
    path: string;
    method?: string;
    body?: unknown;
  }>;
}

interface BatchResponse {
  results: Array<{
    path: string;
    success: boolean;
    data?: unknown;
    error?: string;
    code?: string;
  }>;
}

async function handleBatch(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Batch requires POST' }, ctx.origin);
  }

  let body: BatchRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' }, ctx.origin);
  }

  if (!Array.isArray(body.requests) || body.requests.length === 0) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'requests array required' }, ctx.origin);
  }

  if (body.requests.length > 20) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Max 20 requests per batch' }, ctx.origin);
  }

  const results = await Promise.all(
    body.requests.map(async (req) => {
      try {
        const method = req.method?.toUpperCase() || 'GET';
        const subRequest = new Request(
          `${ctx.env.SHAREOUT_BASE_URL}/v1/data/${ctx.artifactId}${req.path}`,
          {
            method,
            headers: request.headers,
            body: req.body ? JSON.stringify(req.body) : undefined,
          }
        );

        const parts = req.path.split('/').filter(Boolean);
        const [tier, ...rest] = parts;
        const subPath = '/' + rest.join('/');

        // Read-only-default gate applies per sub-request, not per batch envelope:
        // a batch can't be used to smuggle anonymous writes past the gate.
        const denied = anonWriteDenied(tier, method, ctx, ctx.origin);
        if (denied) {
          const body = await denied.json() as { error?: string; code?: string };
          return { path: req.path, success: false, error: body.error, code: body.code };
        }

        let response: Response;
        switch (tier) {
          case 'json':
            response = await handleJsonStore(subRequest, ctx, subPath);
            break;
          case 'tables':
            response = await handleTables(subRequest, ctx, subPath);
            break;
          case 'datasets':
            response = await handleDatasets(subRequest, ctx, subPath);
            break;
          case 'blobs':
            response = await handleBlobs(subRequest, ctx, subPath);
            break;
          default:
            return { path: req.path, success: false, error: 'Unknown tier', code: 'NOT_FOUND' };
        }

        const result = await response.json() as { success: boolean; data?: unknown; error?: string; code?: string };
        return {
          path: req.path,
          success: result.success,
          data: result.data,
          error: result.error,
          code: result.code,
        };
      } catch (e) {
        logError(
          createLogger(ctx.env, {
            scope: 'data.batch',
            event: 'batch.subrequest.failed',
            artifact_id: ctx.artifactId,
            path: req.path,
          }),
          'batch sub-request failed',
          e,
        );
        return {
          path: req.path,
          success: false,
          error: DATA_ERRORS.INTERNAL_ERROR.message,
          code: DATA_ERRORS.INTERNAL_ERROR.code,
        };
      }
    })
  );

  return successResponse<BatchResponse>({ results }, 200, ctx.origin);
}

export async function handleDataRequest(
  request: Request,
  env: Env,
  path: string,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<Response> {
  const origin = request.headers.get('Origin');
  setRequestOrigin(origin);

  try {
    const res = await handleDataRequestInner(request, env, path, origin, waitUntil);
    return withRequestOrigin(res, origin);
  } catch (err) {
    logError(createLogger(env, { scope: 'data', path, event: 'data.request.failed' }), 'data request failed', err);
    return errorResponse(DATA_ERRORS.INTERNAL_ERROR, origin);
  }
}

// Force the CORS origin on the way out from the per-request origin, so a
// concurrent request can't clobber it via the shared module global (which is
// what made responses intermittently return Access-Control-Allow-Origin: null).
// Skip WebSocket upgrades (101) and only touch responses that already carry CORS.
function withRequestOrigin(res: Response, origin: string | null): Response {
  if (res.status === 101) return res;
  if (!res.headers.has('Access-Control-Allow-Origin')) return res;
  const allow = origin === 'null' ? 'null' : origin;
  // Nothing to force when the request carried no Origin — see corsHeaders().
  if (!allow) return res;
  try {
    res.headers.set('Access-Control-Allow-Origin', allow);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', allow);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}

async function handleDataRequestInner(
  request: Request,
  env: Env,
  path: string,
  origin: string | null,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<Response> {

  if (request.method === 'OPTIONS') {
    return handleCorsOptions(request);
  }

  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) {
    return errorResponse(DATA_ERRORS.INVALID_REQUEST, origin);
  }

  const [artifactId, tier, ...rest] = parts;
  const subPath = '/' + rest.join('/');

  // In-page pilot LLM proxy: the 'spike' local-testing id has no real artifact,
  // so it bypasses artifact resolution and config/billing gates. Honor it ONLY
  // for localhost dev requests — production never gets the bypass. Real artifact
  // ids fall through to dataMiddleware and are gated in handlePilot.
  if (tier === 'agent' && rest[0] === 'pilot' && rest[1] === 'chat' && rest[2] === 'completions') {
    // The spike bypass skips all artifact/config/billing gates, so it must be
    // impossible to reach in production. isLocalRequest() trusts the Host header,
    // which an attacker controls — so additionally require the request URL's own
    // hostname to be loopback. On Cloudflare request.url reflects the real routed
    // URL (shareout.site/...), not a spoofed Host, so a `Host: localhost` request
    // to the prod host fails this check and never reaches the spike handler.
    const urlHost = new URL(request.url).hostname;
    const urlIsLoopback = urlHost === 'localhost' || urlHost === '127.0.0.1';
    if (artifactId === 'spike' && urlIsLoopback && isLocalRequest(request, urlHost)) {
      return handlePilotSpike(request, env, origin);
    }
  }

  const ctx = await dataMiddleware(request, env, artifactId);
  if (ctx instanceof Response) {
    return ctx;
  }
  ctx.waitUntil = waitUntil;

  // Sandboxed test run (Artifact Tests Phase 2, Unit B): the render carries an
  // `owner_test` token so reads resolve as the owner and the artifact loads, but
  // NOTHING may persist or send. Block every mutating method across every tier at
  // this one chokepoint — covers stores, email, provision, secrets, sheets, etc.,
  // without trusting each tier's own gate. Reads (GET) pass through unchanged.
  if (ctx.testRun && MUTATING_METHODS.has(request.method.toUpperCase())) {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      message: 'This is a read-only test run — writes, emails, and provisioning are disabled.',
      hint: 'Artifact Tests execute flows against a read-only view; mutations are intentionally blocked.',
    }, origin);
  }

  // Feature-flag gate: most data tiers map 1:1 to a toggle-able feature. The
  // artifact's workspace_id is already resolved (and KV-cached) in ctx, so this
  // is a single cached lookup. Tiers without an entry are never gated.
  const feature = TIER_FEATURE[tier];
  if (feature && !(await isFeatureEnabled(env, feature, ctx.artifact.workspace_id))) {
    return featureDisabledResponse(feature);
  }

  // Read-only-default gate (Workstream A): anonymous viewers of a public artifact
  // cannot mutate its private stores unless the owner opted in. Owner/authenticated
  // writes (ctx.canWrite === true) pass through unchanged.
  const writeDenied = anonWriteDenied(tier, request.method, ctx, origin);
  if (writeDenied) return writeDenied;

  // Realtime/Y.js collab proxies straight to a Durable Object, bypassing any
  // per-store auth. Default-deny anonymous collab on public artifacts: the
  // WebSocket carries bidirectional mutating ops, so we gate the whole tier
  // unless the requester is the owner or anon-collab was explicitly enabled.
  if (tier === 'realtime' && ctx.canWriteCollab !== true) {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      message: 'Realtime collaboration is disabled for anonymous visitors of this artifact.',
      hint: 'The artifact owner can enable anonymous realtime collaboration.',
      suggestion: 'Set allow_anon_collab on the artifact, or sign in as the owner.',
    }, origin);
  }

  switch (tier) {
    case 'batch':
      return handleBatch(request, ctx);

    case 'json':
      return handleJsonStore(request, ctx, subPath);

    case 'tables':
      return handleTables(request, ctx, subPath);

    case 'workspace':
      return handleWorkspaceData(request, ctx, subPath);

    case 'datasets':
      if (rest[0] === '_upload' && rest[1]) {
        return handleDatasetUpload(request, ctx, rest[1]);
      }
      return handleDatasets(request, ctx, subPath);

    case 'connections':
      return handleConnections(request, ctx, subPath);

    case 'secrets':
      return handleSecrets(request, ctx, subPath);

    case 'provision':
      return handleProvision(request, ctx);

    case 'realtime':
      return handleRealtime(request, ctx, subPath);

    case 'comments':
      return handleComments(request, ctx, subPath);

    case 'sheets':
      return handleSheets(request, ctx, subPath);

    case 'github':
      return handleGitHub(request, ctx, subPath);

    case 'blobs':
      if (rest[0] === '_upload' && rest[1]) {
        return handleBlobUpload(request, ctx, rest[1]);
      }
      return handleBlobs(request, ctx, subPath);

    case 'agent':
      return handleAgent(request, ctx, subPath);

    case 'crew':
      return handleCrew(request, ctx, subPath);

    case 'slides':
      return handleSlides(request, ctx, subPath);

    case 'proxy':
      if (subPath === '/config' || subPath === '/config/') {
        return handleProxyConfig(request, ctx);
      }
      return handleProxy(request, ctx, subPath);

    case 'email':
      return handleEmail(request, ctx, subPath);

    case 'inbox':
      return handleInbox(request, ctx, subPath);

    case 'platform':
      return handlePlatformRequest(request, ctx, rest);

    default:
      return errorResponse(DATA_ERRORS.NOT_FOUND, origin);
  }
}
