import { vi } from 'vitest';
import type { CrewProvider, NeutralToolCall, ProviderEvent, ProviderTurnArgs } from '../../../src/crew/provider';
import type { Env } from '../../../src/types';
import type { BuildAgentDeps, PublishOutcome } from '../../../src/build-agent/agent';

export const env = {} as Env;
export const meter = { workspaceId: 'w1', userId: 'u1', kind: 'page_build', source: 'test' };

export type Step = { text?: string; calls?: Array<[string, Record<string, unknown>]>; stop?: string; tokens?: number; error?: ProviderEvent & { type: 'error' } };

/** A provider that plays back one scripted step per model call and records what it was sent. */
export function scriptedProvider(steps: Step[], name = 'vercel-gateway') {
  const calls: ProviderTurnArgs[] = [];
  let n = 0;
  const provider: CrewProvider = {
    provider: name,
    model: 'test-model',
    async *streamTurn(args) {
      calls.push({ ...args, transcript: [...args.transcript] });
      const step = steps[Math.min(n++, steps.length - 1)];
      if (step.error) { yield step.error; return; }
      if (step.text) yield { type: 'text_delta', text: step.text };
      const toolCalls: NeutralToolCall[] = (step.calls ?? []).map(([name, input], i) => ({ id: `t${n}_${i}`, name, input }));
      for (const c of toolCalls) yield { type: 'tool_use', ...c };
      yield { type: 'message_stop', stopReason: step.stop ?? (toolCalls.length ? 'tool_use' : 'end_turn'), usage: { inputTokens: 10, outputTokens: step.tokens ?? 50 } };
    },
  };
  return { provider, calls };
}

export const GOOD_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><h1>Hi</h1><script src="app.js"></script></body></html>`;

export const okPublish = (): BuildAgentDeps['publish'] =>
  vi.fn(async (_files, o): Promise<PublishOutcome> => ({ ok: true, page: { url: 'https://x.test/p', slug: o.slug ?? 'my-page', artifactId: 'a1' } }));

export function deps(provider: CrewProvider, extra: Partial<BuildAgentDeps> = {}): BuildAgentDeps {
  return { env, provider, meter, locale: 'en', isPublic: false, publish: okPublish(), ...extra };
}

/** Tool results the model was sent after call `i` (the transcript of call i+1). */
export function lastToolResults(calls: ProviderTurnArgs[], i: number): string[] {
  const t = calls[i + 1].transcript.at(-1);
  return t && t.role === 'tool' ? t.results.map((r) => r.content) : [];
}
