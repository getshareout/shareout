import { vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';
import type { AgentConfig } from '../../../../src/data/agent/types';

export const ARTIFACT_ID = 'art_test';
export const USER_ID = 'usr_owner';
export const ORIGIN = 'https://app.example.com';
export const BASE_URL = 'https://shareout.example.com';
export const SESSION_SECRET = 'test-session-secret';

export type DbHandler = {
  first?: (sql: string, args: unknown[]) => unknown;
  all?: (sql: string, args: unknown[]) => { results: unknown[] };
  run?: (sql: string, args: unknown[]) => unknown;
};

export function makeDbMock(handlers: DbHandler = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, args) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, args) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, args) ?? { success: true }),
      })),
    })),
    batch: vi.fn(async () => []),
  } as unknown as Env['DB'];
}

export function makeR2Mock(options: {
  getText?: Record<string, string>;
  put?: ReturnType<typeof vi.fn>;
} = {}): Env['ARTIFACTS'] {
  return {
    get: vi.fn(async (key: string) => {
      const text = options.getText?.[key];
      if (text === undefined) return null;
      return { text: async () => text } as R2ObjectBody;
    }),
    put: options.put ?? vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  } as unknown as Env['ARTIFACTS'];
}

export function makeEnv(
  dbHandlers: DbHandler = {},
  extras: Partial<Env> = {},
): Env {
  return {
    DB: makeDbMock(dbHandlers),
    ARTIFACTS: makeR2Mock(),
    SHAREOUT_BASE_URL: BASE_URL,
    SESSION_SECRET,
    OPENAI_API_KEY: 'sk-test-openai',
    ...extras,
  } as Env;
}

export function makeCtx(
  env: Env,
  origin: string | null = ORIGIN,
): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
      // Visitor-chat scenario: owner opted into anonymous AI chat (Workstream A).
      allow_anon_agent: 1,
    },
    env,
    origin,
  } as DataContext;
}

export function sessionCookie(userId: string): string {
  const payload = btoa(JSON.stringify({
    userId,
    email: `${userId}@example.com`,
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64');
  return `${payload}.${signature}`;
}

export function jsonRequest(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  const h = new Headers(headers);
  if (body !== undefined && !h.has('Content-Type')) {
    h.set('Content-Type', 'application/json');
  }
  // Anonymous agent gate uses the unspoofable cf-connecting-ip (fail closed if
  // absent); production CF always sets it, so simulate it here.
  if (!h.has('cf-connecting-ip')) {
    h.set('cf-connecting-ip', '203.0.113.7');
  }
  return new Request(url, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

export const defaultAgentConfig: AgentConfig = {
  artifact_id: ARTIFACT_ID,
  visitor_enabled: true,
  visitor_system_prompt: 'You are helpful.',
  visitor_model: 'gpt-4o',
  visitor_max_tokens: 4096,
  visitor_temperature: 0.7,
  visitor_context_json: true,
  visitor_context_tables: ['items'],
  visitor_context_blobs: true,
  admin_enabled: true,
  admin_model: 'gpt-4o',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export function agentConfigRow(config: Partial<AgentConfig> = {}): Record<string, unknown> {
  const merged = { ...defaultAgentConfig, ...config };
  return {
    artifact_id: merged.artifact_id,
    visitor_enabled: merged.visitor_enabled ? 1 : 0,
    visitor_system_prompt: merged.visitor_system_prompt,
    visitor_model: merged.visitor_model,
    visitor_max_tokens: merged.visitor_max_tokens,
    visitor_temperature: merged.visitor_temperature,
    visitor_context_json: merged.visitor_context_json ? 1 : 0,
    visitor_context_tables: merged.visitor_context_tables
      ? JSON.stringify(merged.visitor_context_tables)
      : null,
    visitor_context_blobs: merged.visitor_context_blobs ? 1 : 0,
    admin_enabled: merged.admin_enabled ? 1 : 0,
    admin_model: merged.admin_model,
    created_at: merged.created_at,
    updated_at: merged.updated_at,
  };
}

/** Build a mock SSE body for OpenAI streaming API. */
export function openAIStreamBody(chunks: string[], usage?: { prompt_tokens: number; completion_tokens: number }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines: string[] = chunks.map((c) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`
  );
  if (usage) {
    lines.push(`data: ${JSON.stringify({ usage })}\n\n`);
  }
  lines.push('data: [DONE]\n\n');
  const payload = lines.join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}
