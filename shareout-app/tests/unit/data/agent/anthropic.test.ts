// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchTimeoutError } from '../../../../src/fetch-utils';

const fireAlert = vi.fn();
vi.mock('../../../../src/observability/alerts', () => ({
  fireAlert: (...args: unknown[]) => (fireAlert(...args), Promise.resolve()),
}));

import {
  AGENT_CHAT_MODEL,
  chat,
  getAgentChatModel,
  getAIProviderChain,
  resolveFailoverChain,
  streamChat,
} from '../../../../src/data/agent/anthropic';
import type { Env } from '../../../../src/types';
import { openAIStreamBody } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
  fireAlert.mockReset();
});

function openaiEnv(): Env {
  return { OPENAI_API_KEY: 'sk-test' } as Env;
}

function gatewayEnv(): Env {
  return { VERCEL_AI_GATEWAY: 'gw-test' } as Env;
}

function bothEnv(): Env {
  return { VERCEL_AI_GATEWAY: 'gw-test', OPENAI_API_KEY: 'sk-test' } as Env;
}

async function collectStream(
  env: Env,
  messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: 'Hi' }],
) {
  const chunks = [];
  for await (const chunk of streamChat(env, messages, 'system prompt', 'gpt-4o', 100)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('getAgentChatModel', () => {
  it('returns default when no provider configured', () => {
    expect(getAgentChatModel({} as Env)).toBe(AGENT_CHAT_MODEL);
  });

  it('returns openai model from OPENAI_API_KEY env', () => {
    expect(getAgentChatModel(openaiEnv())).toBe('gpt-4o');
  });

  it('strips openai/ prefix from gateway model', () => {
    expect(getAgentChatModel(gatewayEnv())).toBe('gpt-4o');
  });
});

describe('streamChat', () => {
  it('yields error when no AI provider is configured', async () => {
    const chunks = await collectStream({} as Env);
    expect(chunks).toEqual([{
      type: 'error',
      error: 'AI provider not configured (need VERCEL_AI_GATEWAY or OPENAI_API_KEY)',
    }]);
  });

  it('streams content and usage from OpenAI API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(openAIStreamBody(['Hello', ' world'], { prompt_tokens: 5, completion_tokens: 3 }), {
        status: 200,
      }),
    );

    const chunks = await collectStream(openaiEnv());

    expect(chunks).toContainEqual({ type: 'content', content: 'Hello' });
    expect(chunks).toContainEqual({ type: 'content', content: ' world' });
    expect(chunks.at(-1)).toEqual({
      type: 'done',
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
  });

  it('uses Vercel gateway when configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(openAIStreamBody(['ok'], { prompt_tokens: 1, completion_tokens: 1 }), { status: 200 }),
    );

    await collectStream(gatewayEnv());

    expect(fetch).toHaveBeenCalledWith(
      'https://ai-gateway.vercel.sh/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gw-test' }),
      }),
    );
  });

  it('filters system messages from chat history', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(openAIStreamBody([], { prompt_tokens: 0, completion_tokens: 0 }), { status: 200 }),
    );

    await collectStream(openaiEnv(), [
      { role: 'system' as 'user', content: 'ignore me' },
      { role: 'user', content: 'Hello' },
    ]);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('yields error on API failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );

    const chunks = await collectStream(openaiEnv());

    expect(chunks[0]).toMatchObject({ type: 'error', error: expect.stringContaining('429') });
  });

  it('yields timeout error on FetchTimeoutError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new FetchTimeoutError('https://api.openai.com', 60000));

    const chunks = await collectStream(openaiEnv());

    expect(chunks).toEqual([{ type: 'error', error: 'AI API request timed out' }]);
  });

  it('yields error (does not throw) on network failure with no fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));

    const chunks = await collectStream(openaiEnv());

    expect(chunks).toEqual([{ type: 'error', error: 'network down' }]);
  });

  it('yields error when response has no body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    const chunks = await collectStream(openaiEnv());

    expect(chunks[0]).toEqual({ type: 'error', error: 'No response body' });
  });

  it('skips malformed SSE JSON lines', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode('data: not-json\n\n'));
        c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
        c.enqueue(encoder.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));

    const chunks = await collectStream(openaiEnv());

    expect(chunks).toContainEqual({ type: 'content', content: 'ok' });
  });
});

describe('getAIProviderChain', () => {
  it('orders gateway first, then openai', () => {
    const chain = getAIProviderChain(bothEnv());
    expect(chain.map((c) => c.provider)).toEqual(['vercel-gateway', 'openai']);
    expect(chain[0].model).toBe('openai/gpt-4o');
    expect(chain[1].model).toBe('gpt-4o');
  });

  it('is just openai when no gateway configured', () => {
    expect(getAIProviderChain(openaiEnv()).map((c) => c.provider)).toEqual(['openai']);
  });

  it('is empty when nothing configured', () => {
    expect(getAIProviderChain({} as Env)).toEqual([]);
  });
});

describe('resolveFailoverChain', () => {
  it('allows failover from an env-derived override to the rest of the chain', () => {
    const chain = getAIProviderChain(bothEnv());
    const attempts = resolveFailoverChain(bothEnv(), chain[0]);
    expect(attempts.map((c) => c.provider)).toEqual(['vercel-gateway', 'openai']);
  });

  it('gives a bring-your-own key no failover', () => {
    const byo = { provider: 'openai' as const, apiKey: 'sk-user-byo', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' };
    const attempts = resolveFailoverChain(bothEnv(), byo);
    expect(attempts).toEqual([byo]);
  });
});

describe('streamChat failover', () => {
  it('retries the next provider when the first fails pre-first-byte (402) and alerts', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('no credits', { status: 402 }))
      .mockResolvedValueOnce(
        new Response(openAIStreamBody(['recovered'], { prompt_tokens: 1, completion_tokens: 1 }), { status: 200 }),
      );

    const chunks = await collectStream(bothEnv());

    // gateway (dead) then openai (ok)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(chunks).toContainEqual({ type: 'content', content: 'recovered' });
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
    expect(fireAlert).toHaveBeenCalledWith(
      expect.anything(),
      'ai:provider:failed:vercel-gateway',
      expect.stringContaining('failed over'),
      expect.any(Number),
    );
  });

  it('does NOT fail over once content has streamed', async () => {
    const encoder = new TextEncoder();
    let stage = 0;
    const midStreamError = new ReadableStream({
      pull(c) {
        if (stage === 0) {
          c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
          stage = 1;
        } else {
          c.error(new Error('mid-stream boom'));
        }
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(midStreamError, { status: 200 }));

    const chunks = await collectStream(bothEnv());

    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry after bytes emitted
    expect(chunks).toContainEqual({ type: 'content', content: 'partial' });
    expect(chunks.at(-1)).toMatchObject({ type: 'error' });
    expect(fireAlert).not.toHaveBeenCalled();
  });

  it('alerts that requests are failing when the last provider fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));

    const chunks = await collectStream(openaiEnv());

    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: expect.stringContaining('429') });
    expect(fireAlert).toHaveBeenCalledWith(
      expect.anything(),
      'ai:provider:failed:openai',
      expect.stringContaining('No fallback left'),
      expect.any(Number),
    );
  });

  it('does NOT alert when a bring-your-own key fails (not our outage, and it would burn the dedup key)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no credits', { status: 402 }));
    const byo = { provider: 'openai' as const, apiKey: 'sk-user-byo', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' };

    const chunks = [];
    for await (const chunk of streamChat(bothEnv(), [{ role: 'user', content: 'Hi' }], 'sys', 'gpt-4o', 100, byo)) {
      chunks.push(chunk);
    }

    expect(chunks.at(-1)).toMatchObject({ type: 'error' });
    expect(fireAlert).not.toHaveBeenCalled();
  });
});

describe('chat', () => {
  it('throws when no provider configured', async () => {
    await expect(chat({} as Env, [{ role: 'user', content: 'Hi' }], 'sys', 'gpt-4o')).rejects.toThrow(
      'AI provider not configured',
    );
  });

  it('returns content and usage from non-streaming API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Answer' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200 }),
    );

    const result = await chat(openaiEnv(), [{ role: 'user', content: 'Q' }], 'sys', 'gpt-4o', 512);

    expect(result).toEqual({
      content: 'Answer',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  });

  it('throws on API error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('bad request', { status: 400 }),
    );

    await expect(chat(openaiEnv(), [{ role: 'user', content: 'Q' }], 'sys', 'gpt-4o')).rejects.toThrow(
      'AI API error: 400',
    );
  });

  it('returns empty content when choice is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 0 },
      }), { status: 200 }),
    );

    const result = await chat(openaiEnv(), [{ role: 'user', content: 'Q' }], 'sys', 'gpt-4o');

    expect(result.content).toBe('');
  });
});
