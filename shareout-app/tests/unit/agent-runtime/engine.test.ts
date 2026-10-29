// The shared agent engine against a scripted provider: budgets, cut-off replies and tool calls,
// ending a run from a tool or a reply, context management per route, and provider errors.
import { describe, expect, it, vi } from 'vitest';
import { newStats, runEngine, type EngineConfig, type EngineLimits } from '../../../src/agent-runtime/engine';
import type { NeutralTurn } from '../../../src/crew/provider';
import { lastToolResults, meter, scriptedProvider, type Step } from '../build-agent/helpers';

const LIMITS: EngineLimits = { maxTurns: 10, wallMs: 60_000, maxOutputTokens: 100_000, turnTokens: 8_000 };
const list: Step = { calls: [['list', {}]] };

function config(provider: EngineConfig<string>['provider'], extra: Partial<EngineConfig<string>> = {}): EngineConfig<string> {
  return {
    provider,
    meter,
    system: 'sys',
    transcript: [{ role: 'user', text: 'go' }],
    tools: [{ name: 'list', description: 'list', input_schema: { type: 'object', properties: {} } }],
    limits: LIMITS,
    runTool: async (call) => (call.name === 'done' ? { content: 'ok', finish: 'finished' } : call.name === 'stop' ? { end: 'stopped' } : { content: `ran ${call.name}` }),
    onStop: (turn) => ({ end: `said: ${turn.text}` }),
    cutOff: { invalidCall: (call) => `INVALID ${call.name}`, reply: 'smaller please', note: ' (cut)' },
    ...extra,
  };
}

describe('runEngine', () => {
  it('runs tools until the model replies, then ends with what onStop returns', async () => {
    const { provider, calls } = scriptedProvider([list, { text: 'all done' }]);
    const r = await runEngine(config(provider));
    expect(r).toMatchObject({ kind: 'end', result: 'said: all done' });
    expect(lastToolResults(calls, 0)).toEqual(['ran list']);
    expect(calls[0]).toMatchObject({ system: 'sys', maxTokens: 8_000, meter });
  });

  it('a nudge keeps the run going with the nudge as the next user message', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'hmm' }, { text: 'ok' }]);
    let n = 0;
    const r = await runEngine(config(provider, { onStop: (t) => (n++ === 0 ? { nudge: 'keep going' } : { end: t.text }) }));
    expect(r).toMatchObject({ kind: 'end', result: 'ok' });
    expect(calls[1].transcript.at(-1)).toEqual({ role: 'user', text: 'keep going' });
  });

  it('finish skips the rest of the batch; end stops at once', async () => {
    const fin = scriptedProvider([{ calls: [['done', {}], ['list', {}]] }]);
    const seen: string[] = [];
    const r = await runEngine(config(fin.provider, { skipped: 'SKIPPED', runTool: async (c) => { seen.push(c.name); return c.name === 'done' ? { content: 'ok', finish: 'finished' } : { content: 'x' }; } }));
    expect(r).toMatchObject({ kind: 'end', result: 'finished' });
    expect(seen).toEqual(['done']);

    const stop = scriptedProvider([{ calls: [['stop', {}], ['list', {}]] }]);
    expect(await runEngine(config(stop.provider))).toMatchObject({ kind: 'end', result: 'stopped' });
  });

  it('asks again when a reply is cut off with no tool call', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'a very long', stop: 'max_tokens' }, { text: 'short' }]);
    const r = await runEngine(config(provider));
    expect(r).toMatchObject({ kind: 'end', result: 'said: short' });
    expect(calls[1].transcript.at(-1)).toEqual({ role: 'user', text: 'smaller please' });
  });

  it('without a cut-off reply, a cut-off text reply goes to onStop', async () => {
    const { provider } = scriptedProvider([{ text: 'partial', stop: 'max_tokens' }]);
    const r = await runEngine(config(provider, { cutOff: { invalidCall: () => 'x' } }));
    expect(r).toMatchObject({ kind: 'end', result: 'said: partial' });
  });

  it('a half-written tool call does nothing and is answered; a cut-off batch gets a note', async () => {
    const runTool = vi.fn(async () => ({ content: 'ran' }));
    const { provider, calls } = scriptedProvider([
      { calls: [['list', {}], ['write', { __invalid_json: '{"path":"a' }]], stop: 'max_tokens' },
      { text: 'fine' },
    ]);
    await runEngine(config(provider, { runTool }));
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(lastToolResults(calls, 0)).toEqual(['ran', 'INVALID write (cut)']);
  });

  it('stops at the call cap', async () => {
    const { provider, calls } = scriptedProvider([list]);
    const r = await runEngine(config(provider, { limits: { ...LIMITS, maxTurns: 3 } }));
    expect(r).toMatchObject({ kind: 'limit', limit: 'turns' });
    expect(calls).toHaveLength(3);
    // The transcript comes back so the caller can wrap up from it.
    expect(r.transcript.at(-1)).toMatchObject({ role: 'tool' });
  });

  it('stops at the output-token budget and counts what was spent', async () => {
    const { provider, calls } = scriptedProvider([{ calls: [['list', {}]], tokens: 6_000 }]);
    const stats = newStats();
    const r = await runEngine(config(provider, { limits: { ...LIMITS, maxOutputTokens: 10_000 }, stats }));
    expect(r).toMatchObject({ kind: 'limit', limit: 'tokens' });
    expect(calls).toHaveLength(2);
    expect(stats).toMatchObject({ calls: 2, outputTokens: 12_000, inputTokens: 20 });
  });

  it('stops at the wall-clock limit', async () => {
    const { provider } = scriptedProvider([list]);
    const now = vi.spyOn(Date, 'now');
    let t = 0;
    now.mockImplementation(() => (t += 10_000));
    const r = await runEngine(config(provider, { limits: { ...LIMITS, wallMs: 50_000 } }));
    now.mockRestore();
    expect(r).toMatchObject({ kind: 'limit', limit: 'time' });
  });

  it('returns a provider error as is', async () => {
    const { provider } = scriptedProvider([{ error: { type: 'error', error: 'down', code: 'x' } }]);
    expect(await runEngine(config(provider))).toMatchObject({ kind: 'error', error: { error: 'down', code: 'x' } });
  });

  it('streams text deltas and offers the tools as they are when each call starts', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'one', calls: [['list', {}]] }, { text: 'two' }]);
    const deltas: string[] = [];
    let open = false;
    await runEngine(config(provider, {
      onTextDelta: (d) => { deltas.push(d); },
      tools: () => [{ name: open ? 'more' : 'list', description: '', input_schema: {} }],
      runTool: async () => { open = true; return { content: 'ok' }; },
    }));
    expect(deltas).toEqual(['one', 'two']);
    expect(calls.map((c) => c.tools[0].name)).toEqual(['list', 'more']);
  });
});

describe('context management per route', () => {
  const big = 'y'.repeat(20_000);
  const longTranscript = (): NeutralTurn[] => {
    const out: NeutralTurn[] = [{ role: 'user', text: 'build it' }];
    for (let i = 0; i < 12; i++) {
      out.push({ role: 'assistant', text: '', toolCalls: [{ id: `c${i}`, name: 'write_file', input: { path: `f${i}.js`, content: big } }] });
      out.push({ role: 'tool', results: [{ id: `c${i}`, content: 'created' }] });
    }
    return out;
  };
  const native = { compactAtTokens: 100_000 };

  it('trims old tool inputs on a non-Anthropic route, and passes the native harness through untouched', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'ok' }], 'vercel-gateway');
    await runEngine(config(provider, { transcript: longTranscript(), native }));
    const sent = calls[0].transcript[1] as Extract<NeutralTurn, { role: 'assistant' }>;
    expect(sent.toolCalls[0].input.content).toMatch(/^\[20000 chars written/);
    expect(calls[0].native).toEqual(native);
  });

  it('leaves the transcript to the server on the direct Anthropic route', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'ok' }], 'anthropic');
    await runEngine(config(provider, { transcript: longTranscript(), native }));
    const sent = calls[0].transcript[1] as Extract<NeutralTurn, { role: 'assistant' }>;
    expect(sent.toolCalls[0].input.content).toBe(big);
    expect(calls[0].native).toEqual(native);
  });

  it('trim: false sends the transcript as it is', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'ok' }]);
    await runEngine(config(provider, { transcript: longTranscript(), trim: false }));
    expect((calls[0].transcript[1] as Extract<NeutralTurn, { role: 'assistant' }>).toolCalls[0].input.content).toBe(big);
  });

  it('keeps a compaction block on the assistant turn so the next call carries it back', async () => {
    const { provider, calls } = scriptedProvider([list, { text: 'done' }], 'anthropic');
    const inner = provider.streamTurn.bind(provider);
    let first = true;
    provider.streamTurn = async function* (args) {
      if (first) { first = false; yield { type: 'compaction', content: 'SUMMARY' }; }
      yield* inner(args);
    };
    await runEngine(config(provider));
    expect(calls[1].transcript[1]).toMatchObject({ role: 'assistant', compaction: 'SUMMARY' });
  });
});
