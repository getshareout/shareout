import type { Env } from '../../types';
import { DATA_ERRORS } from '../../types';
import type { DataContext } from '../middleware';
import { errorResponse, corsHeaders } from '../middleware';
import { getAIProvider, AGENT_CHAT_MODEL, type AIConfig } from './anthropic';
import { resolveAgentAiConfig, recordAgentUsage } from './ai-config';
import { getAgentConfig } from './visitor-chat';
import { checkRateLimit, incrementRateLimit, recordUsage } from './usage';
import { checkSlidingWindowRateLimit, getTrustedClientIp } from '../../rate-limit';
import { fetchWithTimeout, FetchTimeoutError } from '../../fetch-utils';
import {
  logPilotUpstreamFailure,
  pilotUpstreamErrorBody,
} from './errors';
import { jsonWithApiErrors } from '../../http/api-error';

const PILOT_UPSTREAM_TIMEOUT_MS = 60000;
const MAX_BODY_BYTES = 400 * 1024;
const MAX_MESSAGES = 120;
const MAX_MSG_CHARS = 24 * 1024;
const PILOT_STEP_CAP = 20;
const PILOT_STEP_TTL_SEC = 900;
const VALID_ROLES = new Set(['system', 'user', 'assistant', 'tool']);
const TASK_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

// Page DOM text is serialized into user/tool messages by the client, so treat it
// as untrusted: neutralize common attempts to override the agent's system prompt.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /disregard\s+(the\s+)?(above|previous|prior)/gi,
  /you\s+are\s+now/gi,
  /system\s+prompt/gi,
  /<\/?system>/gi,
  /new\s+instructions\s*:/gi,
];

interface PilotRequestBody {
  model?: unknown;
  messages?: unknown;
  tools?: Array<{ function?: { name?: string }; name?: string }>;
  tool_choice?: unknown;
  temperature?: unknown;
  parallel_tool_calls?: unknown;
  stream?: unknown;
}

interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

function pilotError(message: string, status: number, origin: string | null): Response {
  return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message, status }, origin);
}

function jsonError(body: Record<string, unknown>, status: number, origin: string | null): Response {
  const headers = new Headers(corsHeaders(origin) as HeadersInit);
  if (typeof body.retryAfter === 'number') {
    headers.set('Retry-After', String(body.retryAfter));
  }
  // Strip retryAfter from JSON body once exposed as header; keep error/code for envelope.
  const { retryAfter: _ra, ...rest } = body;
  return jsonWithApiErrors(rest, status, headers);
}

function toolName(tool: { function?: { name?: string }; name?: string }): string | undefined {
  return tool?.function?.name ?? tool?.name;
}

function validateMessages(messages: unknown, origin: string | null): { messages: unknown[] } | Response {
  if (!Array.isArray(messages)) return pilotError('messages is required', 400, origin);
  if (messages.length > MAX_MESSAGES) {
    return pilotError(`messages exceeds the ${MAX_MESSAGES}-message cap`, 400, origin);
  }
  let systemSeen = false;
  for (let i = 0; i < messages.length; i++) {
    const role = (messages[i] as { role?: unknown })?.role;
    if (typeof role !== 'string' || !VALID_ROLES.has(role)) {
      return pilotError('Each message role must be one of system, user, assistant, tool', 400, origin);
    }
    if (role === 'system') {
      if (i !== 0 || systemSeen) {
        return pilotError('A system message must be the first and only system message', 400, origin);
      }
      systemSeen = true;
    }
  }
  return { messages };
}

function scrubText(text: string): string {
  let out = text;
  for (const re of INJECTION_PATTERNS) out = out.replace(re, '[filtered]');
  if (out.length > MAX_MSG_CHARS) out = out.slice(0, MAX_MSG_CHARS) + '\n…[truncated]';
  return out;
}

// Server-side defense against prompt injection via reserialized page DOM: cap and
// scrub user/tool message text before forwarding. The system message (index 0) is
// set by the SDK and is never touched; assistant messages are left intact.
function sanitizeMessages(messages: unknown[]): unknown[] {
  return messages.map((m, i) => {
    const msg = m as { role?: unknown; content?: unknown };
    if (i === 0 || (msg.role !== 'user' && msg.role !== 'tool')) return m;
    if (typeof msg.content === 'string') {
      return { ...msg, content: scrubText(msg.content) };
    }
    if (Array.isArray(msg.content)) {
      const content = msg.content.map((part) => {
        const p = part as { type?: unknown; text?: unknown };
        return typeof p.text === 'string' ? { ...p, text: scrubText(p.text) } : part;
      });
      return { ...msg, content };
    }
    return m;
  });
}

function parseBody(rawBody: string, origin: string | null): { body: PilotRequestBody } | Response {
  if (rawBody.length > MAX_BODY_BYTES) return pilotError('Request body too large', 413, origin);
  try {
    return { body: JSON.parse(rawBody) as PilotRequestBody };
  } catch {
    return pilotError('Invalid JSON', 400, origin);
  }
}

function buildForwardBody(body: PilotRequestBody, messages: unknown[], model: string): Record<string, unknown> {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const forwardBody: Record<string, unknown> = { model, messages, stream: false };
  if (tools.length > 0) forwardBody.tools = tools;
  if (body.tool_choice !== undefined) forwardBody.tool_choice = body.tool_choice;
  if (body.temperature !== undefined) forwardBody.temperature = body.temperature;
  if (body.parallel_tool_calls !== undefined) forwardBody.parallel_tool_calls = body.parallel_tool_calls;
  return forwardBody;
}

async function forwardToProvider(
  baseUrl: string,
  apiKey: string,
  forwardText: string,
  origin: string | null
): Promise<Response | { upstream: Response; text: string }> {
  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: forwardText,
      },
      PILOT_UPSTREAM_TIMEOUT_MS
    );
  } catch (err) {
    const message = err instanceof FetchTimeoutError ? 'AI provider request timed out' : 'AI provider request failed';
    return jsonError({ error: message, code: 'UPSTREAM_ERROR' }, 502, origin);
  }
  return { upstream, text: await upstream.text() };
}

function parseUsage(text: string): UpstreamUsage {
  try {
    return (JSON.parse(text) as { usage?: UpstreamUsage }).usage ?? {};
  } catch {
    return {};
  }
}

/** Current step count for a task; null = no KV (cap disabled). */
async function readStepCount(env: Env, artifactId: string, taskId: string): Promise<number | null> {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return null;
  return parseInt((await kv.get(`pilotstep:${artifactId}:${taskId}`)) || '0', 10) || 0;
}

async function bumpStepCount(env: Env, artifactId: string, taskId: string, current: number): Promise<void> {
  await env.RATE_LIMIT_KV?.put(`pilotstep:${artifactId}:${taskId}`, String(current + 1), {
    expirationTtl: PILOT_STEP_TTL_SEC,
  });
}

function upstreamFailureResponse(
  env: Env,
  upstream: Response,
  upstreamText: string,
  origin: string | null,
  fields: { artifactId: string; mode: 'pilot' | 'pilot_spike'; taskId?: string },
): Response {
  logPilotUpstreamFailure(env, {
    artifactId: fields.artifactId,
    mode: fields.mode,
    upstreamStatus: upstream.status,
    upstreamBody: upstreamText,
    taskId: fields.taskId,
  });
  return new Response(JSON.stringify(pilotUpstreamErrorBody(upstream.status)), {
    status: 502,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/**
 * Real-artifact pilot path: opt-in gate, visitor access + rate limits, billing
 * gate, per-task step cap, and correct workspace/BYO billing attribution.
 */
export async function handlePilot(request: Request, ctx: DataContext): Promise<Response> {
  const { env, origin, artifactId } = ctx;
  if (request.method !== 'POST') {
    return pilotError('Method not allowed', 405, origin);
  }

  // Owner opt-in gate: pilot must be explicitly enabled for public viewers. The
  // OWNER (verified identity — e.g. a crew/`pilot_verify` headless run driving the
  // artifact via an injected owner session) may run pilot regardless, so UI-level
  // QA works even on artifacts that never enabled pilot for the public. Only the
  // owner check is bypassed here; the anon gate and billing below are unchanged.
  if (ctx.isOwner !== true) {
    const config = await getAgentConfig(ctx);
    if (!config || !config.pilot_enabled) {
      return jsonError({ error: 'Pilot is not enabled for this artifact', code: 'PILOT_DISABLED' }, 403, origin);
    }
  }

  // Anonymous-access gate (mirror visitor-chat): anon AI on a public artifact
  // drains the owner's budget, so default-deny unless the owner opted in.
  const isPublic = ctx.artifact.visibility === 'public';
  const isAnon = !ctx.viewer?.email && ctx.isOwner !== true;
  if (isPublic && isAnon && ctx.artifact.allow_anon_agent !== 1) {
    return errorResponse(
      {
        ...DATA_ERRORS.FORBIDDEN,
        message: 'AI pilot is disabled for anonymous visitors of this artifact.',
        hint: 'The artifact owner can enable anonymous AI chat (allow_anon_agent) or sign in.',
      },
      origin
    );
  }

  if (isAnon) {
    const ip = getTrustedClientIp(request);
    if (!ip) {
      return errorResponse({ ...DATA_ERRORS.FORBIDDEN, message: 'Could not verify your network; request blocked.' }, origin);
    }
    const ipLimit = await checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, `pilot:${ip}`, 'aiChat');
    if (!ipLimit.allowed) {
      return jsonError(
        { error: 'Too many requests from your network. Try again later.', code: 'RATE_LIMIT_EXCEEDED', retryAfter: ipLimit.retryAfter },
        429,
        origin
      );
    }
    const ownerId = ctx.artifact.owner_id;
    if (ownerId) {
      const ownerLimit = await checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, `pilotowner:${ownerId}`, 'aiChat');
      if (!ownerLimit.allowed) {
        return jsonError(
          { error: 'This page is temporarily over its AI usage limit. Try later.', code: 'RATE_LIMIT_EXCEEDED', retryAfter: ownerLimit.retryAfter },
          429,
          origin
        );
      }
    }
  }

  const rateLimit = await checkRateLimit(env, artifactId);
  if (!rateLimit.allowed) {
    return jsonError(
      { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED', retryAfter: rateLimit.retryAfter },
      429,
      origin
    );
  }

  const taskId = request.headers.get('x-pilot-task') || '';
  if (!TASK_ID_RE.test(taskId)) {
    return pilotError('x-pilot-task header is required (8-64 chars, [A-Za-z0-9-])', 400, origin);
  }
  // Step cap: peek → gate → commit, so a credit-blocked first step doesn't burn
  // the counter (a retry with the same taskId would then look mid-task and slip
  // past the credit gate).
  const stepCount = await readStepCount(env, artifactId, taskId);
  if (stepCount !== null && stepCount >= PILOT_STEP_CAP) {
    return jsonError({ error: 'This task has reached its step limit.', code: 'PILOT_STEP_CAP' }, 429, origin);
  }

  const ai = await resolveAgentAiConfig(env, artifactId);
  if (!ai.aiConfig) {
    return errorResponse({ ...DATA_ERRORS.INTERNAL_ERROR, message: 'AI provider not configured' }, origin);
  }
  if (stepCount !== null) await bumpStepCount(env, artifactId, taskId, stepCount);

  const rawBody = await request.text();
  const parsed = parseBody(rawBody, origin);
  if (parsed instanceof Response) return parsed;
  const body = parsed.body;

  const validated = validateMessages(body.messages, origin);
  if (validated instanceof Response) return validated;

  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.some((t) => toolName(t) === 'execute_javascript')) {
    return pilotError('The execute_javascript tool is not permitted', 400, origin);
  }

  const aiConfig = ai.aiConfig;
  const pilotModel = env.PILOT_MODEL ? env.PILOT_MODEL.replace(/^openai\//, '') : aiConfig.model.replace(/^openai\//, '');
  const forwardBody = buildForwardBody(body, sanitizeMessages(validated.messages), pilotModel);
  const forwardText = JSON.stringify(forwardBody);
  if (forwardText.length > MAX_BODY_BYTES) {
    return pilotError('Request body too large', 413, origin);
  }

  const forwarded = await forwardToProvider(aiConfig.baseUrl, aiConfig.apiKey, forwardText, origin);
  if (forwarded instanceof Response) return forwarded;
  const { upstream, text: upstreamText } = forwarded;

  if (upstream.ok) {
    const usage = parseUsage(upstreamText);
    const inputTokens = usage.prompt_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? 0;
    await recordUsage(env, artifactId, 'pilot', inputTokens, outputTokens).catch(() => {});
    await incrementRateLimit(env, artifactId, inputTokens + outputTokens).catch(() => {});
    await recordAgentUsage(env, {
      workspaceId: ai.workspaceId,
      artifactId,
      conversationId: null,
      mode: 'pilot',
      provider: aiConfig.provider,
      model: env.PILOT_MODEL ?? aiConfig.model,
      inputTokens,
      outputTokens,
      byo: ai.byo,
    }).catch(() => {});
    return new Response(upstreamText, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }

  return upstreamFailureResponse(env, upstream, upstreamText, origin, {
    artifactId,
    mode: 'pilot',
    taskId,
  });
}

// Exposed for unit tests; not part of the request-handling surface.
export const _internal = { sanitizeMessages, MAX_MSG_CHARS };

/**
 * Localhost-only spike path: the 'spike' id has no real artifact, so it bypasses
 * config/billing gates for local testing. Production never reaches this — the
 * router only dispatches here for localhost requests.
 */
export async function handlePilotSpike(request: Request, env: Env, origin: string | null): Promise<Response> {
  if (request.method !== 'POST') {
    return pilotError('Method not allowed', 405, origin);
  }

  const ip = getTrustedClientIp(request);
  if (!ip) {
    return errorResponse({ ...DATA_ERRORS.FORBIDDEN, message: 'Could not verify your network; request blocked.' }, origin);
  }
  const ipLimit = await checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, `pilot:${ip}`, 'aiChat');
  if (!ipLimit.allowed) {
    return jsonError(
      { error: 'Too many requests from your network. Try again later.', code: 'RATE_LIMIT_EXCEEDED', retryAfter: ipLimit.retryAfter },
      429,
      origin
    );
  }

  const rawBody = await request.text();
  const parsed = parseBody(rawBody, origin);
  if (parsed instanceof Response) return parsed;
  const body = parsed.body;

  const validated = validateMessages(body.messages, origin);
  if (validated instanceof Response) return validated;

  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.some((t) => toolName(t) === 'execute_javascript')) {
    return pilotError('The execute_javascript tool is not permitted', 400, origin);
  }

  const provider: AIConfig | null = getAIProvider(env);
  if (!provider) {
    return errorResponse({ ...DATA_ERRORS.INTERNAL_ERROR, message: 'AI provider not configured' }, origin);
  }

  const model = env.PILOT_MODEL || provider.model || AGENT_CHAT_MODEL;
  const forwardBody = buildForwardBody(body, sanitizeMessages(validated.messages), model);
  const forwardText = JSON.stringify(forwardBody);
  if (forwardText.length > MAX_BODY_BYTES) {
    return pilotError('Request body too large', 413, origin);
  }

  const forwarded = await forwardToProvider(provider.baseUrl, provider.apiKey, forwardText, origin);
  if (forwarded instanceof Response) return forwarded;
  const { upstream, text: upstreamText } = forwarded;

  if (upstream.ok) {
    const usage = parseUsage(upstreamText);
    console.log(`[pilot] usage prompt=${usage.prompt_tokens ?? 0} completion=${usage.completion_tokens ?? 0} model=${model}`);
    return new Response(upstreamText, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }

  return upstreamFailureResponse(env, upstream, upstreamText, origin, {
    artifactId: 'spike',
    mode: 'pilot_spike',
  });
}
