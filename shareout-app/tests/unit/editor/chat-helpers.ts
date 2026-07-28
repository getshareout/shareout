import { vi } from 'vitest';
import type { EditorContext } from '../../../src/editor/index';
import type { Env } from '../../../src/types';

export const ARTIFACT_ID = 'art_chat';
export const USER_ID = 'usr_chat';

export function makeDbMock(handlers: {
  run?: (sql: string, ...args: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true, meta: { changes: 1 } }),
      })),
    })),
  } as unknown as Env['DB'];
}

export function makeCtx(env: Env): EditorContext {
  return {
    artifactId: ARTIFACT_ID,
    userId: USER_ID,
    userName: 'Chat Tester',
    role: 'owner',
    env,
  };
}

export async function readSSE(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

export function parseSSEEvents(raw: string): Array<Record<string, unknown>> {
  return raw
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice(6)) as Record<string, unknown>);
}

/** OpenAI-compatible SSE for editor chat (content deltas + [DONE]). */
export function editorOpenAIDoneStream(fullContent: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: fullContent } }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('')));
      controller.close();
    },
  });
}

/** OpenAI stream that completes via finish_reason=stop (no [DONE]). */
export function editorOpenAIStopStream(fullContent: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: fullContent } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }] })}\n\n`,
  ];
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('')));
      controller.close();
    },
  });
}

/** Anthropic SSE with content_block_delta chunks and message_stop. */
export function editorAnthropicStopStream(fullContent: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const half = Math.ceil(fullContent.length / 2);
  const lines = [
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: fullContent.slice(0, half) } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: fullContent.slice(half) } })}\n\n`,
    'data: {"type":"message_stop"}\n\n',
  ];
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('')));
      controller.close();
    },
  });
}

/** Anthropic SSE that ends with [DONE] instead of message_stop. */
export function editorAnthropicDoneStream(fullContent: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = [
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: fullContent } })}\n\n`,
    'data: [DONE]\n\n',
  ];
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('')));
      controller.close();
    },
  });
}
