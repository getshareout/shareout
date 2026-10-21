// Model prices come from the AI Gateway's live catalog, never a hand-kept table.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../../src/types';
import { catalogIds, loadModelPrices, priceCall, resetModelPrices } from '../../../../src/data/agent/model-costs';

const CATALOG = { data: [
  { id: 'anthropic/claude-sonnet-5.5', pricing: { input: '0.000003', output: '0.000015' } },
  { id: 'openai/gpt-4o', pricing: { input: '0.0000025', output: '0.00001' } },
  { id: 'some/embedder', pricing: { input: '0.0000001' } },
] };
const env = {} as Env;

beforeEach(() => { resetModelPrices(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('catalogIds', () => {
  it('maps provider-native ids onto gateway catalog ids', () => {
    expect(catalogIds('claude-sonnet-5-5')).toContain('anthropic/claude-sonnet-5.5');
    expect(catalogIds('gpt-4o')).toContain('openai/gpt-4o');
    expect(catalogIds('anthropic/claude-sonnet-5.5')[0]).toBe('anthropic/claude-sonnet-5.5');
    expect(catalogIds('claude-sonnet-4-20250514')).toContain('anthropic/claude-sonnet-4');
  });
});

describe('priceCall', () => {
  it('prices from the live catalog (USD/token → micro-USD) and caches it', async () => {
    const fetchMock = vi.fn(async () => Response.json(CATALOG));
    vi.stubGlobal('fetch', fetchMock);
    expect(await priceCall(env, 'claude-sonnet-5-5', 1000, 100)).toEqual({ microUsd: 3000 + 1500, priced: true });
    expect(await priceCall(env, 'openai/gpt-4o', 2000, 0)).toEqual({ microUsd: 5000, priced: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a model the catalog lacks is unpriced, never guessed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(CATALOG)));
    expect(await priceCall(env, 'mystery-model-9', 1000, 1000)).toEqual({ microUsd: 0, priced: false });
  });

  it('catalog down: unpriced, and a later call retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    expect(await loadModelPrices(env)).toBeNull();
    expect((await priceCall(env, 'gpt-4o', 10, 10)).priced).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(CATALOG)));
    expect((await priceCall(env, 'gpt-4o', 10, 10)).priced).toBe(true);
  });
});
