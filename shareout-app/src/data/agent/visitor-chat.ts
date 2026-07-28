import type { DataContext } from '../middleware';
import { errorResponse, successResponse } from '../middleware';
import { DATA_ERRORS } from '../../types';
import type { AgentConfig, ChatRequest, Conversation, Message } from './types';
import { streamChat } from './anthropic';
import { buildVisitorContext, buildVisitorSystemPrompt } from './context';
import { checkRateLimit, incrementRateLimit, recordUsage, recordError } from './usage';
import { resolveAgentAiConfig, recordAgentUsage } from './ai-config';
import { checkSlidingWindowRateLimit, getTrustedClientIp } from '../../rate-limit';
import { VisitorStore } from '../../chat-agent/store/visitor-store';
import {
  logAgentChatFailure,
  userFacingAgentChatFailure,
  userFacingAgentStreamError,
} from './errors';

export async function handleVisitorChat(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
  }

  // Read-only-default gate (Workstream A): anonymous AI chat on a PUBLIC artifact
  // drains the owner's AI budget, and the existing limiter is per-artifact (so N
  // artifacts = N budgets to drain). Default-deny anonymous chat on public
  // artifacts unless the owner opted in (allow_anon_agent); authenticated viewers
  // and private/workspace artifacts are unaffected. Add a per-requester-IP limit
  // (unspoofable cf-connecting-ip) on top of the per-artifact limiter below.
  const isPublic = ctx.artifact.visibility === 'public';
  const isAnon = !ctx.viewer?.email && ctx.isOwner !== true;
  if (isPublic && isAnon && ctx.artifact.allow_anon_agent !== 1) {
    return errorResponse(
      {
        ...DATA_ERRORS.FORBIDDEN,
        message: 'AI chat is disabled for anonymous visitors of this artifact.',
        hint: 'The artifact owner can enable anonymous AI chat (allow_anon_agent) or sign in.',
      },
      ctx.origin
    );
  }
  if (isAnon) {
    const ip = getTrustedClientIp(request);
    if (!ip) {
      return errorResponse(
        { ...DATA_ERRORS.FORBIDDEN, message: 'Could not verify your network; chat blocked.' },
        ctx.origin
      );
    }
    const ipLimit = await checkSlidingWindowRateLimit(ctx.env.RATE_LIMIT_KV, `agent:${ip}`, 'aiChat');
    if (!ipLimit.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: 'Too many chat requests from your network. Try again later.', code: 'RATE_LIMIT_EXCEEDED', retryAfter: ipLimit.retryAfter }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(ipLimit.retryAfter || 60) } }
      );
    }
    // Per-OWNER cap (Workstream G): the per-artifact + per-IP limits don't stop an
    // attacker spreading anon chats across many of one owner's artifacts to drain
    // their AI budget. Cap aggregate anon chat per owner too.
    const ownerId = ctx.artifact.owner_id;
    if (ownerId) {
      const ownerLimit = await checkSlidingWindowRateLimit(ctx.env.RATE_LIMIT_KV, `agentowner:${ownerId}`, 'aiChat');
      if (!ownerLimit.allowed) {
        return new Response(
          JSON.stringify({ success: false, error: 'This page is temporarily over its AI usage limit. Try later.', code: 'RATE_LIMIT_EXCEEDED', retryAfter: ownerLimit.retryAfter }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(ownerLimit.retryAfter || 60) } }
        );
      }
    }
  }

  // Get agent config
  const config = await getAgentConfig(ctx);
  if (!config || !config.visitor_enabled) {
    return errorResponse({ ...DATA_ERRORS.FORBIDDEN, message: 'Agent not enabled for this artifact' }, ctx.origin);
  }

  // Check rate limit
  const rateLimit = await checkRateLimit(ctx.env, ctx.artifactId);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: rateLimit.retryAfter,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'Retry-After': String(rateLimit.retryAfter || 60),
        },
      }
    );
  }

  // Resolve which provider key serves this agent.
  const ai = await resolveAgentAiConfig(ctx.env, ctx.artifactId);
  if (!ai.aiConfig) {
    return errorResponse({ ...DATA_ERRORS.INTERNAL_ERROR, message: 'AI provider not configured' }, ctx.origin);
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' }, ctx.origin);
  }

  if (!body.message || typeof body.message !== 'string') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'message is required' }, ctx.origin);
  }

  // AI credit gate (B7). Grace: never kill an in-flight conversation — only block a
  // NEW one. The conversation must actually exist for this artifact: VisitorStore
  // Get or create conversation (history + persistence via the shared store contract).
  const store = body.conversationId
    ? new VisitorStore(ctx.env, body.conversationId)
    : await VisitorStore.create(ctx.env, ctx.artifactId, body.message);
  const conversationId = store.id;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = body.conversationId
    ? await store.loadHistory()
    : [];

  // Add user message. If the page supplied per-message `context` (live/external
  // data that isn't in sdk.json/tables — e.g. a warehouse query result), append
  // it to the model-facing copy so the agent can answer from it. The persisted
  // copy stays clean: no token bloat in history, and only the current turn ever
  // carries a snapshot, so the model always sees the freshest data.
  let modelContent = body.message;
  if (body.context && typeof body.context === 'object' && !Array.isArray(body.context)) {
    let ctxJson = '';
    try { ctxJson = JSON.stringify(body.context); } catch { ctxJson = ''; }
    if (ctxJson && ctxJson !== '{}') {
      const MAX_CONTEXT_CHARS = 200_000; // guard against runaway payloads
      if (ctxJson.length > MAX_CONTEXT_CHARS) ctxJson = ctxJson.slice(0, MAX_CONTEXT_CHARS) + '…(truncated)';
      modelContent = `${body.message}\n\n## Live page data (current on-screen context — treat as authoritative; do not ask the user to provide it)\n\`\`\`json\n${ctxJson}\n\`\`\``;
    }
  }
  messages.push({ role: 'user', content: modelContent });

  // Save user message (clean text only — never the injected context block)
  await store.appendMessage('user', body.message);

  // Build context and system prompt
  const visitorContext = await buildVisitorContext(ctx, config);
  const systemPrompt = buildVisitorSystemPrompt(config.visitor_system_prompt, visitorContext);
  const aiConfig = ai.aiConfig;
  const chatModel = aiConfig.model.replace(/^openai\//, '');

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
          chatModel,
          config.visitor_max_tokens,
          aiConfig
        )) {
          if (chunk.type === 'content' && chunk.content) {
            fullContent += chunk.content;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: chunk.content, conversationId })}\n\n`));
          } else if (chunk.type === 'done' && chunk.usage) {
            inputTokens = chunk.usage.input_tokens;
            outputTokens = chunk.usage.output_tokens;
          } else if (chunk.type === 'error') {
            logAgentChatFailure(ctx.env, 'visitor chat stream error', chunk.error, {
              artifactId: ctx.artifactId,
              mode: 'visitor',
              conversationId,
              upstreamError: chunk.error,
            });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              error: userFacingAgentStreamError(chunk.error),
            })}\n\n`));
            await recordError(ctx.env, ctx.artifactId, 'visitor');
          }
        }

        // Save assistant message + roll up conversation token counters.
        await store.appendAssistantTurn(fullContent, inputTokens, outputTokens, chatModel);

        // Record usage
        await recordUsage(ctx.env, ctx.artifactId, 'visitor', inputTokens, outputTokens);
        await incrementRateLimit(ctx.env, ctx.artifactId, inputTokens + outputTokens);
        await recordAgentUsage(ctx.env, {
          workspaceId: ai.workspaceId,
          artifactId: ctx.artifactId,
          conversationId,
          mode: 'visitor',
          provider: aiConfig.provider,
          model: aiConfig.model,
          inputTokens,
          outputTokens,
          byo: ai.byo,
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', conversationId, usage: { input_tokens: inputTokens, output_tokens: outputTokens } })}\n\n`));
        controller.close();
      } catch (error) {
        logAgentChatFailure(ctx.env, 'visitor chat failed', error, {
          artifactId: ctx.artifactId,
          mode: 'visitor',
          conversationId,
        });
        await recordError(ctx.env, ctx.artifactId, 'visitor');
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

export async function handleConversations(
  request: Request,
  ctx: DataContext,
  conversationId?: string,
  action?: string
): Promise<Response> {
  if (conversationId) {
    if (request.method === 'GET') {
      const conversation = await ctx.env.DB.prepare(`
        SELECT * FROM agent_threads WHERE id = ? AND scope_key = ?
      `).bind(conversationId, ctx.artifactId).first<Conversation>();

      if (!conversation) {
        return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
      }

      const messages = await ctx.env.DB.prepare(`
        SELECT * FROM agent_messages WHERE thread_id = ? ORDER BY created_at ASC
      `).bind(conversationId).all();

      return successResponse({
        conversation,
        messages: messages.results,
      }, 200, ctx.origin);
    }

    if (request.method === 'DELETE') {
      await ctx.env.DB.prepare(`
        DELETE FROM agent_threads WHERE id = ? AND scope_key = ?
      `).bind(conversationId, ctx.artifactId).run();

      return successResponse({ deleted: true }, 200, ctx.origin);
    }

    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
  }

  // List conversations
  if (request.method !== 'GET') {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  // The API still speaks 'visitor'/'admin'; the table keys them as scope types.
  const mode = url.searchParams.get('mode') === 'admin' ? 'admin' : 'visitor';
  const scopeType = `artifact_${mode}`;

  const conversations = await ctx.env.DB.prepare(`
    SELECT * FROM agent_threads
    WHERE scope_type = ? AND scope_key = ?
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).bind(scopeType, ctx.artifactId, limit, offset).all();

  const countResult = await ctx.env.DB.prepare(`
    SELECT COUNT(*) as count FROM agent_threads WHERE scope_type = ? AND scope_key = ?
  `).bind(scopeType, ctx.artifactId).first<{ count: number }>();

  return successResponse({
    conversations: conversations.results,
    total: countResult?.count || 0,
    limit,
    offset,
  }, 200, ctx.origin);
}

export async function handleVisitorConfig(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (request.method === 'GET') {
    const config = await getAgentConfig(ctx);
    return successResponse({ config, pilot_enabled: !!config?.pilot_enabled }, 200, ctx.origin);
  }

  if (request.method === 'PUT') {
    let body: Partial<AgentConfig>;
    try {
      body = await request.json();
    } catch {
      return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' }, ctx.origin);
    }

    const existingConfig = await getAgentConfig(ctx);

    if (existingConfig) {
      await ctx.env.DB.prepare(`
        UPDATE artifact_agent_config
        SET
          visitor_enabled = COALESCE(?, visitor_enabled),
          visitor_system_prompt = COALESCE(?, visitor_system_prompt),
          visitor_model = COALESCE(?, visitor_model),
          visitor_max_tokens = COALESCE(?, visitor_max_tokens),
          visitor_temperature = COALESCE(?, visitor_temperature),
          visitor_context_json = COALESCE(?, visitor_context_json),
          visitor_context_tables = COALESCE(?, visitor_context_tables),
          visitor_context_blobs = COALESCE(?, visitor_context_blobs),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE artifact_id = ?
      `).bind(
        body.visitor_enabled !== undefined ? (body.visitor_enabled ? 1 : 0) : null,
        body.visitor_system_prompt ?? null,
        body.visitor_model ?? null,
        body.visitor_max_tokens ?? null,
        body.visitor_temperature ?? null,
        body.visitor_context_json !== undefined ? (body.visitor_context_json ? 1 : 0) : null,
        body.visitor_context_tables !== undefined
          ? (body.visitor_context_tables ? JSON.stringify(body.visitor_context_tables) : null)
          : null,
        body.visitor_context_blobs !== undefined ? (body.visitor_context_blobs ? 1 : 0) : null,
        ctx.artifactId
      ).run();
    } else {
      await ctx.env.DB.prepare(`
        INSERT INTO artifact_agent_config (
          artifact_id, visitor_enabled, visitor_system_prompt, visitor_model,
          visitor_max_tokens, visitor_temperature, visitor_context_json,
          visitor_context_tables, visitor_context_blobs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        ctx.artifactId,
        body.visitor_enabled ? 1 : 0,
        body.visitor_system_prompt || null,
        body.visitor_model || 'gpt-4o',
        body.visitor_max_tokens || 4096,
        body.visitor_temperature || 0.7,
        body.visitor_context_json !== false ? 1 : 0,
        body.visitor_context_tables ? JSON.stringify(body.visitor_context_tables) : null,
        body.visitor_context_blobs ? 1 : 0
      ).run();
    }

    const updatedConfig = await getAgentConfig(ctx);
    return successResponse({ config: updatedConfig }, 200, ctx.origin);
  }

  return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Method not allowed' }, ctx.origin);
}

export async function getAgentConfig(ctx: DataContext): Promise<AgentConfig | null> {
  const row = await ctx.env.DB.prepare(`
    SELECT * FROM artifact_agent_config WHERE artifact_id = ?
  `).bind(ctx.artifactId).first();

  if (!row) return null;

  return {
    artifact_id: row.artifact_id as string,
    visitor_enabled: !!row.visitor_enabled,
    pilot_enabled: !!row.pilot_enabled,
    visitor_system_prompt: row.visitor_system_prompt as string | null,
    visitor_model: row.visitor_model as string,
    visitor_max_tokens: row.visitor_max_tokens as number,
    visitor_temperature: row.visitor_temperature as number,
    visitor_context_json: !!row.visitor_context_json,
    visitor_context_tables: row.visitor_context_tables
      ? JSON.parse(row.visitor_context_tables as string)
      : null,
    visitor_context_blobs: !!row.visitor_context_blobs,
    admin_enabled: !!row.admin_enabled,
    admin_model: row.admin_model as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
