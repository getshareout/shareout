// A scanned PDF goes to the model as a document part, in each provider's wire format.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { transcribePdf } from '../../../src/data/files/transcribe-pdf';

function sse(provider: 'anthropic' | 'openai'): Response {
  const body = provider === 'anthropic'
    ? 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"# Matriz"}}\n\ndata: {"type":"message_stop"}\n\n'
    : 'data: {"choices":[{"delta":{"content":"# Matriz"}}]}\n\ndata: [DONE]\n\n';
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('transcribePdf', () => {
  it.each([
    ['anthropic', { ANTHROPIC_API_KEY: 'k', AI_PROVIDER_ORDER: 'anthropic' }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBER' } }],
    ['openai', { OPENAI_API_KEY: 'k', AI_PROVIDER_ORDER: 'openai' }, { type: 'file', file: { filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBER' } }],
  ] as const)('sends the PDF as a document part (%s)', async (provider, keys, part) => {
    const fetchMock = vi.fn(async () => sse(provider));
    vi.stubGlobal('fetch', fetchMock);
    expect(await transcribePdf(keys as unknown as Env, 'JVBER')).toBe('# Matriz');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const msg = provider === 'anthropic' ? body.messages[0] : body.messages[1];
    expect(msg.content[0]).toEqual(part);
  });

  it('asks the model to carry on when a long scan hits the output cap', async () => {
    const cut = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Página 1"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\ndata: {"type":"message_stop"}\n\n';
    const rest = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Página 2"}}\n\ndata: {"type":"message_stop"}\n\n';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(cut, { headers: { 'Content-Type': 'text/event-stream' } }))
      .mockResolvedValueOnce(new Response(rest, { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await transcribePdf({ ANTHROPIC_API_KEY: 'k', AI_PROVIDER_ORDER: 'anthropic' } as unknown as Env, 'JVBER')).toBe('Página 1\nPágina 2');
    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(second.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.messages[1].content).toBe('Página 1');
  });

  it('skips without a provider or past the size cap', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await transcribePdf({} as Env, 'JVBER')).toBeNull();
    expect(await transcribePdf({ ANTHROPIC_API_KEY: 'k' } as unknown as Env, 'x'.repeat(27_000_001))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
