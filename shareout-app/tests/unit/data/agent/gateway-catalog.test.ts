// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGatewayModels } from '../../../../src/data/agent/gateway-catalog';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockCatalog(data: unknown[]): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ object: 'list', data }), { status: 200 })));
}

describe('fetchGatewayModels', () => {
  it('keeps only tool-calling language models', async () => {
    mockCatalog([
      { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', owned_by: 'deepseek', type: 'language', supported_parameters: ['tools'] },
      { id: 'openai/text-embedding-3-small', name: 'Embedding', owned_by: 'openai', type: 'embedding' },
      { id: 'alibaba/qwen-3-14b', name: 'Qwen3-14B', owned_by: 'alibaba', type: 'language', tags: ['tool-use'] },
      { id: 'no-tools/model', name: 'No tools', owned_by: 'x', type: 'language' },
    ]);

    const models = await fetchGatewayModels();
    expect(models.map((m) => m.id)).toEqual(['alibaba/qwen-3-14b', 'deepseek/deepseek-v4.1-flash']);
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(fetchGatewayModels()).rejects.toThrow(/HTTP 500/);
  });
});
