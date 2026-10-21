// Every model call lands in ai_usage_events with its workspace, user, action, model, real
// input/output tokens and cost — the source of each workspace's monthly AI spend report.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';
import { meterAiCall, type AiMeter } from '../../../src/data/ai-usage';
import { chat, chatComplete } from '../../../src/data/agent/anthropic';
import { crewProviderFor } from '../../../src/crew/provider';

const METER: AiMeter = { workspaceId: null, userId: null, kind: 'test_call', source: 'art_1' };
const env = () => ({ ...e, ANTHROPIC_API_KEY: 'k', AI_PROVIDER_ORDER: 'anthropic' }) as unknown as Env;

type Row = { kind: string; model: string; units: number; input_tokens: number; output_tokens: number; base_cost_micro_usd: number; source: string; cost_source: string; provider_ref: string | null };
const rows = async () => (await e.DB.prepare("SELECT kind, model, units, input_tokens, output_tokens, base_cost_micro_usd, source, cost_source, provider_ref FROM ai_usage_events WHERE kind = 'test_call'").all<Row>()).results;
const sse = (events: unknown[]) => new Response(events.map((x) => `data: ${JSON.stringify(x)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });

beforeAll(async () => { await applyMigrations(); });
beforeEach(async () => { await e.DB.prepare("DELETE FROM ai_usage_events WHERE kind = 'test_call'").run(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('meterAiCall', () => {
  it('writes one pending row with input/output tokens and the gateway generation id', async () => {
    await meterAiCall(e, METER, 'anthropic/claude-sonnet-5.5', 1200, 300, 'gen_01X');
    expect(await rows()).toEqual([{
      kind: 'test_call', model: 'anthropic/claude-sonnet-5.5', units: 1500, input_tokens: 1200, output_tokens: 300,
      base_cost_micro_usd: 0, source: 'art_1', cost_source: 'pending', provider_ref: 'gen_01X',
    }]);
  });

  it('skips empty usage and never throws when the ledger write fails', async () => {
    await meterAiCall(e, METER, 'gpt-4o', 0, 0);
    expect(await rows()).toEqual([]);
    const broken = { ...e, DB: { prepare: () => { throw new Error('db down'); } } } as unknown as Env;
    await expect(meterAiCall(broken, METER, 'gpt-4o', 10, 10)).resolves.toBeUndefined();
  });
});

describe('provider entry points meter every call', () => {
  it('chatComplete / streamChat: real streamed usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'message_start', message: { usage: { input_tokens: 900 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hola' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } },
      { type: 'message_stop' },
    ])));
    expect(await chatComplete(env(), METER, [{ role: 'user', content: 'hi' }], 'sys', 100)).toBe('hola');
    expect(await rows()).toMatchObject([{ input_tokens: 900, output_tokens: 42 }]);
  });

  it('a gateway call keeps its generation id for the real-cost reconcile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { id: 'gen_01GW', choices: [{ delta: { content: 'ok' } }] },
      { id: 'gen_01GW', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 2 } },
    ])));
    const gw = { ...e, VERCEL_AI_GATEWAY: 'k', AI_PROVIDER_ORDER: 'vercel-gateway' } as unknown as Env;
    await chatComplete(gw, METER, [{ role: 'user', content: 'hi' }], 'sys', 50);
    expect(await rows()).toMatchObject([{ input_tokens: 30, output_tokens: 2, provider_ref: 'gen_01GW', cost_source: 'pending' }]);
  });

  it('chat (non-streaming)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 70, output_tokens: 5 } })));
    await chat(env(), METER, [{ role: 'user', content: 'hi' }], 'sys', '', 50);
    expect(await rows()).toMatchObject([{ input_tokens: 70, output_tokens: 5 }]);
  });

  it('crew provider turns (assistant chat, crews, triage, home brief)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'message_start', message: { usage: { input_tokens: 500 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } },
      { type: 'message_stop' },
    ])));
    const provider = crewProviderFor(env(), { provider: 'anthropic', apiKey: 'k', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' });
    for await (const _ of provider.streamTurn({ system: 's', transcript: [{ role: 'user', text: 'hi' }], tools: [], maxTokens: 50, meter: METER })) { /* drain */ }
    expect(await rows()).toMatchObject([{ model: 'claude-sonnet-5-5', input_tokens: 500, output_tokens: 12 }]);
  });
});
