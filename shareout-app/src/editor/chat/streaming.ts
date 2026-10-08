/**
 * Server-sent event streaming for editor AI chat.
 *
 * Model calls go through the shared provider path (streamChat): workspace model,
 * BYO key, provider failover and the first-byte timeout. Lasso mode sends the
 * screenshot as an image on the user message; the client SSE contract is unchanged.
 */

import type { Env } from '../../types';
import { streamChat, type ChatImage } from '../../data/agent/anthropic';
import { resolveAgentAiConfig } from '../../data/agent/ai-config';
import { userFacingAgentStreamError } from '../../data/agent/errors';
import { debugError, debugLog, EDITOR_MAX_TOKENS } from './config';
import type { ChatMessage } from './history';
import { parseAgentResponse } from './parse-response';
import { storePendingChange } from './pending-changes';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

export const TRUNCATED_RESPONSE_ERROR = 'The AI response was cut off because it was too long. Try a smaller change.';

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

/** Run one model turn over streamChat and relay it as editor SSE (content… then one done or error). */
function streamEditorTurn(
  env: Env,
  options: {
    messages: Array<{ role: 'user' | 'assistant'; content: string; image?: ChatImage }>;
    systemPrompt: string;
    artifactId: string;
    userId: string;
    mode: string;
    userPrompt?: string;
    logCategory: string;
  }
): Response {
  const startTime = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const ai = await resolveAgentAiConfig(env, options.artifactId);
        if (!ai.aiConfig) {
          debugError(options.logCategory, 'No AI provider configured');
          controller.enqueue(sseError(encoder, 'AI not configured'));
          controller.close();
          return;
        }
        debugLog(options.logCategory, 'Starting AI request', {
          provider: ai.aiConfig.provider,
          model: ai.aiConfig.model,
          mode: options.mode,
          systemPromptLength: options.systemPrompt.length,
          messagesCount: options.messages.length,
        });

        let fullContent = '';
        for await (const chunk of streamChat(
          env, options.messages, options.systemPrompt, '', EDITOR_MAX_TOKENS, ai.aiConfig
        )) {
          if (chunk.type === 'content' && chunk.content) {
            fullContent += chunk.content;
            controller.enqueue(sseEvent(encoder, { type: 'content', content: chunk.content }));
          } else if (chunk.type === 'error') {
            debugError(options.logCategory, 'AI stream error', chunk.error);
            controller.enqueue(sseError(encoder, userFacingAgentStreamError(chunk.error)));
            break;
          } else if (chunk.type === 'done') {
            debugLog(options.logCategory, 'Stream complete', {
              contentLength: fullContent.length,
              truncated: !!chunk.truncated,
              totalDurationMs: Date.now() - startTime,
            });
            if (chunk.truncated) {
              controller.enqueue(sseError(encoder, TRUNCATED_RESPONSE_ERROR));
            } else {
              await emitDoneEvent(encoder, controller, {
                env,
                artifactId: options.artifactId,
                userId: options.userId,
                mode: options.mode,
                fullContent,
                userPrompt: options.userPrompt,
                logCategory: options.logCategory,
              });
            }
            break;
          }
        }
      } catch (error) {
        debugError('STREAM', 'Stream error', error);
        controller.enqueue(sseError(encoder, 'Stream failed'));
      }
      controller.close();
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
  return streamEditorTurn(env, {
    messages,
    systemPrompt,
    artifactId,
    userId,
    mode,
    userPrompt: messages[messages.length - 1]?.content ?? '',
    logCategory: 'STREAM',
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
  const mediaTypeMatch = imageBase64.match(/^data:([^;]+);base64,/);
  const image: ChatImage = {
    mediaType: mediaTypeMatch ? mediaTypeMatch[1] : 'image/png',
    data: imageBase64.replace(/^data:[^;]+;base64,/, ''),
  };
  return streamEditorTurn(env, {
    messages: [{ role: 'user', content: prompt, image }],
    systemPrompt,
    artifactId,
    userId,
    mode: 'lasso',
    logCategory: 'VISION',
  });
}
