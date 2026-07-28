/**
 * Server-sent event streaming for editor AI chat.
 *
 * Text modes stream token deltas from Anthropic or OpenAI-compatible APIs.
 * Lasso mode sends a vision payload (screenshot + prompt) on the same SSE wire format.
 */

import type { Env } from '../../types';
import {
  debugError,
  debugLog,
  EDITOR_MAX_TOKENS,
  getAIProvider,
  type AIProvider,
} from './config';
import type { ChatMessage } from './history';
import { parseAgentResponse } from './parse-response';
import { storePendingChange } from './pending-changes';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

function sseEvent(encoder: TextEncoder, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function sseError(encoder: TextEncoder, message: string): Uint8Array {
  return sseEvent(encoder, { type: 'error', error: message });
}

/** Parse a completed model turn, persist it, and emit the terminal SSE `done` event. */
async function emitDoneEvent(
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController<Uint8Array>,
  options: {
    env: Env;
    artifactId: string;
    userId: string;
    mode: string;
    fullContent: string;
    userPrompt?: string;
    logCategory: string;
  }
): Promise<void> {
  const parsed = parseAgentResponse(options.fullContent);
  debugLog(options.logCategory, 'Parsed response', {
    type: parsed.type,
    hasPatches: !!parsed.patches?.length,
    patchCount: parsed.patches?.length || 0,
    hasHtml: !!parsed.html,
    messagePreview: parsed.message?.slice(0, 100),
  });

  const changeId = await storePendingChange(
    options.env,
    options.artifactId,
    options.userId,
    options.mode,
    parsed,
    options.userPrompt
  );
  const storeCategory = options.logCategory === 'VISION' ? 'VISION_STORE' : 'STORE';
  debugLog(storeCategory, 'Stored pending change', { changeId });

  controller.enqueue(sseEvent(encoder, {
    type: 'done',
    changeId,
    response: parsed,
  }));
}

/** Handle one provider-specific SSE JSON line. */
async function handleProviderSseEvent(
  provider: AIProvider,
  event: Record<string, unknown>,
  state: {
    encoder: TextEncoder;
    controller: ReadableStreamDefaultController<Uint8Array>;
    content: { text: string };
    env: Env;
    artifactId: string;
    userId: string;
    mode: string;
    userPrompt?: string;
    logCategory: string;
  }
): Promise<void> {
  if (provider === 'anthropic') {
    const delta = event.delta as { text?: string } | undefined;
    if (event.type === 'content_block_delta' && delta?.text) {
      state.content.text += delta.text;
      state.controller.enqueue(sseEvent(state.encoder, {
        type: 'content',
        content: delta.text,
      }));
    }

    if (event.type === 'message_stop') {
      debugLog(state.logCategory, 'Anthropic message_stop received');
      await emitDoneEvent(state.encoder, state.controller, {
        env: state.env,
        artifactId: state.artifactId,
        userId: state.userId,
        mode: state.mode,
        fullContent: state.content.text,
        userPrompt: state.userPrompt,
        logCategory: state.logCategory,
      });
    }

    return;
  }

  const choices = event.choices as Array<{ delta?: { content?: string }; finish_reason?: string }> | undefined;
  const content = choices?.[0]?.delta?.content;
  if (content) {
    state.content.text += content;
    state.controller.enqueue(sseEvent(state.encoder, {
      type: 'content',
      content,
    }));
  }

  if (choices?.[0]?.finish_reason === 'stop') {
    debugLog(state.logCategory, 'OpenAI finish_reason=stop received');
    await emitDoneEvent(state.encoder, state.controller, {
      env: state.env,
      artifactId: state.artifactId,
      userId: state.userId,
      mode: state.mode,
      fullContent: state.content.text,
      userPrompt: state.userPrompt,
      logCategory: state.logCategory,
    });
  }
}

async function pumpUpstreamSse(
  response: globalThis.Response,
  options: {
    env: Env;
    provider: AIProvider;
    artifactId: string;
    userId: string;
    mode: string;
    userPrompt?: string;
    logCategory: string;
    startTime: number;
  },
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();
  const reader = response.body?.getReader();
  if (!reader) {
    debugError(options.logCategory, 'No response body');
    controller.enqueue(sseError(encoder, 'No response'));
    controller.close();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  const content = { text: '' };
  let chunkCount = 0;
  let eventCount = 0;

  debugLog(options.logCategory, 'Starting to read response stream...');

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      debugLog(options.logCategory, 'Stream complete', {
        totalChunks: chunkCount,
        totalEvents: eventCount,
        contentLength: content.text.length,
        totalDurationMs: Date.now() - options.startTime,
      });
      break;
    }

    chunkCount++;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      eventCount++;
      const data = line.slice(6);
      if (data === '[DONE]') {
        debugLog(options.logCategory, 'Received [DONE] signal');
        await emitDoneEvent(encoder, controller, {
          env: options.env,
          artifactId: options.artifactId,
          userId: options.userId,
          mode: options.mode,
          fullContent: content.text,
          userPrompt: options.userPrompt,
          logCategory: options.logCategory,
        });
        continue;
      }

      try {
        const event = JSON.parse(data) as Record<string, unknown>;
        await handleProviderSseEvent(options.provider, event, {
          encoder,
          controller,
          content,
          env: options.env,
          artifactId: options.artifactId,
          userId: options.userId,
          mode: options.mode,
          userPrompt: options.userPrompt,
          logCategory: options.logCategory,
        });
      } catch (parseError) {
        debugError(`${options.logCategory}_PARSE`, 'Failed to parse SSE event', parseError);
      }
    }
  }

  controller.close();
}

function wrapSseStream(
  pump: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await pump(controller);
      } catch (error) {
        const encoder = new TextEncoder();
        debugError('STREAM', 'Stream error', error);
        controller.enqueue(sseError(encoder, 'Stream failed'));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

/** Stream a multi-turn text chat completion to the editor client. */
export function createStreamingResponse(
  env: Env,
  messages: ChatMessage[],
  systemPrompt: string,
  artifactId: string,
  userId: string,
  mode: string
): Response {
  const startTime = Date.now();
  const userPrompt = messages[messages.length - 1]?.content ?? '';

  return wrapSseStream(async (controller) => {
    const encoder = new TextEncoder();
    const aiConfig = getAIProvider(env);
    if (!aiConfig) {
      debugError('STREAM', 'No AI provider configured');
      controller.enqueue(sseError(encoder, 'AI not configured'));
      controller.close();
      return;
    }

    const { provider, apiKey, baseUrl, model } = aiConfig;
    debugLog('STREAM', 'Starting AI request', {
      provider,
      model,
      baseUrl,
      mode,
      systemPromptLength: systemPrompt.length,
      messagesCount: messages.length,
    });

    const requestStartTime = Date.now();
    const response = provider === 'anthropic'
      ? await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: EDITOR_MAX_TOKENS,
          system: systemPrompt,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      })
      : await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: EDITOR_MAX_TOKENS,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: true,
        }),
      });

    debugLog('API', 'API response received', {
      status: response.status,
      ok: response.ok,
      requestDurationMs: Date.now() - requestStartTime,
    });

    if (!response.ok) {
      const error = await response.text();
      debugError('API', `API error (${response.status})`, error);
      controller.enqueue(sseError(encoder, `API error: ${response.status}`));
      controller.close();
      return;
    }

    await pumpUpstreamSse(response, {
      env,
      provider,
      artifactId,
      userId,
      mode,
      userPrompt,
      logCategory: 'STREAM',
      startTime,
    }, controller);
  });
}

/** Stream a vision (lasso screenshot) completion to the editor client. */
export function createVisionStreamingResponse(
  env: Env,
  prompt: string,
  imageBase64: string,
  systemPrompt: string,
  artifactId: string,
  userId: string
): Response {
  const startTime = Date.now();

  return wrapSseStream(async (controller) => {
    const encoder = new TextEncoder();
    const aiConfig = getAIProvider(env);
    if (!aiConfig) {
      debugError('VISION', 'No AI provider configured');
      controller.enqueue(sseError(encoder, 'AI not configured'));
      controller.close();
      return;
    }

    const { provider, apiKey, baseUrl, model } = aiConfig;
    const mediaTypeMatch = imageBase64.match(/^data:([^;]+);base64,/);
    const mediaType = mediaTypeMatch ? mediaTypeMatch[1] : 'image/png';
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');

    debugLog('VISION', 'Starting vision request', {
      provider,
      model,
      baseUrl,
      mediaType,
      imageSize: `${Math.round(base64Data.length / 1024)}KB`,
      systemPromptLength: systemPrompt.length,
      promptLength: prompt.length,
    });

    const requestStartTime = Date.now();
    const response = provider === 'anthropic'
      ? await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: EDITOR_MAX_TOKENS,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              { type: 'text', text: prompt },
            ],
          }],
          stream: true,
        }),
      })
      : await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: EDITOR_MAX_TOKENS,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${mediaType};base64,${base64Data}` },
                },
                { type: 'text', text: prompt },
              ],
            },
          ],
          stream: true,
        }),
      });

    debugLog('VISION', 'API response received', {
      status: response.status,
      ok: response.ok,
      requestDurationMs: Date.now() - requestStartTime,
    });

    if (!response.ok) {
      const error = await response.text();
      debugError('VISION', `API error (${response.status})`, error);
      controller.enqueue(sseError(encoder, `API error: ${response.status}`));
      controller.close();
      return;
    }

    await pumpUpstreamSse(response, {
      env,
      provider,
      artifactId,
      userId,
      mode: 'lasso',
      logCategory: 'VISION',
      startTime,
    }, controller);
  });
}
