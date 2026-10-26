// REST for Verify: run one (POST /v1/artifacts/:id/verify), read the latest
// (GET …/verify/latest) and fetch its screenshots (GET …/verify/:run/:viewport.webp).
// Owners and editors only; workspace Agent tokens are bounded in src/verify/service.ts.
import type { FetchContext } from '../context';
import { allowingAgentTokens, isAuthUser } from '../helpers/auth-guard';
import { jsonResponse } from '../helpers/json-response';
import { apiErrorResponse, jsonWithApiErrors } from '../../http/api-error';
import { servingOrigin } from '../../workspaces/domains/host-binding';
import { latestVerify, presentResult, runVerify, verifyScreenshot, type VerifyFailure, type VerifyInput } from '../../verify/service';
import type { Viewport } from '../../verify/types';
import { VIEWPORT_NAMES } from '../../verify/types';

function failure(f: VerifyFailure): Response {
  if (f.limit) {
    const retryAfter = Math.max(1, f.limit.reset - Math.floor(Date.now() / 1000));
    return jsonWithApiErrors({
      success: false,
      error: f.error,
      code: f.code,
      hint: f.hint,
      limit: f.limit.limit,
      remaining: 0,
      reset: f.limit.reset,
      retryAfter,
    }, 429, { 'Retry-After': String(retryAfter), 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(f.limit.reset) });
  }
  return apiErrorResponse({ status: f.status, code: f.code, message: f.error, hint: f.hint, param: f.param });
}

function invalid(message: string, param: string): Response {
  return apiErrorResponse({ status: 400, code: 'VALIDATION_ERROR', message, param });
}

async function parseInput(request: Request): Promise<VerifyInput | Response> {
  const text = await request.text();
  if (!text.trim()) return {};
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return apiErrorResponse({ status: 400, code: 'INVALID_JSON', message: 'Invalid JSON', hint: 'Send {} or { "version": 3, "viewports": ["mobile"], "full_page": true }.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Body must be a JSON object', 'body');
  const input: VerifyInput = {};
  if (body.version !== undefined && body.version !== null) {
    if (!Number.isInteger(body.version) || (body.version as number) < 1) return invalid('version must be a positive integer (the version number)', 'version');
    input.version = body.version as number;
  }
  if (body.viewports !== undefined && body.viewports !== null) {
    const list = body.viewports;
    if (!Array.isArray(list) || !list.length || !list.every((v) => VIEWPORT_NAMES.includes(v as Viewport))) {
      return invalid('viewports must be a non-empty list of "desktop" and/or "mobile"', 'viewports');
    }
    input.viewports = list as Viewport[];
  }
  if (body.full_page !== undefined && body.full_page !== null) {
    if (typeof body.full_page !== 'boolean') return invalid('full_page must be true or false', 'full_page');
    input.fullPage = body.full_page;
  }
  return input;
}

/** POST /v1/artifacts/:id/verify — render the page as its viewers get it and report what broke. */
export async function handleVerifyRun(ctx: FetchContext, artifactId: string): Promise<Response> {
  const user = await allowingAgentTokens.requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  const input = await parseInput(ctx.request);
  if (input instanceof Response) return input;
  const outcome = await runVerify(ctx.env, user, artifactId, input);
  if (!outcome.ok) return failure(outcome);
  return jsonResponse(presentResult(outcome.result, servingOrigin(ctx.env)));
}

/** GET /v1/artifacts/:id/verify/latest */
export async function handleVerifyLatest(ctx: FetchContext, artifactId: string): Promise<Response> {
  const user = await allowingAgentTokens.requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  const outcome = await latestVerify(ctx.env, user, artifactId);
  if (!outcome.ok) return failure(outcome);
  return jsonResponse(presentResult(outcome.result, servingOrigin(ctx.env)));
}

/** GET /v1/artifacts/:id/verify/:runId/:viewport.webp */
export async function handleVerifyScreenshot(ctx: FetchContext, artifactId: string, runId: string, viewport: string): Promise<Response> {
  const user = await allowingAgentTokens.requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  if (!/^vfy_[0-9a-f]{24}$/.test(runId) || !VIEWPORT_NAMES.includes(viewport as Viewport)) {
    return apiErrorResponse({ status: 404, code: 'NOT_FOUND', message: 'No such screenshot' });
  }
  const outcome = await verifyScreenshot(ctx.env, user, artifactId, runId, viewport as Viewport);
  if (!outcome.ok) return failure(outcome);
  return new Response(outcome.body.body, {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
