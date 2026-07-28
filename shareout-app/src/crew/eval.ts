import type { Env } from '../types';
import type { DataContext } from '../data/middleware';
import type { CrewRow, CrewRunRow, CrewSseEvent } from './types';
import type { CrewProvider, ProviderEvent, ProviderTurnArgs } from './provider';
import { executeCrewRun } from './run-loop';

// A basic eval harness: drive a crew with a deterministic, scripted provider and
// assert the observed tool-call sequence contains the expected tools and none of
// the forbidden ones. Offline (no live model), so it's a fast safety net.

export interface MockTurn {
  text?: string;
  toolCalls?: Array<{ name: string; input?: Record<string, unknown> }>;
  usage?: { inputTokens: number; outputTokens: number };
}

/** Scripted provider: emits one MockTurn per model call, in order (last repeats). */
export function mockProvider(turns: MockTurn[]): CrewProvider {
  let i = 0;
  return {
    provider: 'mock',
    model: 'mock-model',
    async *streamTurn(_args: ProviderTurnArgs): AsyncGenerator<ProviderEvent> {
      const turn = turns[Math.min(i, turns.length - 1)] ?? {};
      i++;
      if (turn.text) yield { type: 'text_delta', text: turn.text };
      const calls = turn.toolCalls ?? [];
      for (let k = 0; k < calls.length; k++) {
        yield { type: 'tool_use', id: `mock_${i}_${k}`, name: calls[k].name, input: calls[k].input ?? {} };
      }
      yield {
        type: 'message_stop',
        stopReason: calls.length ? 'tool_use' : 'end_turn',
        usage: turn.usage ?? { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}

export interface EvalSpec {
  crew: CrewRow;
  run: CrewRunRow;
  ownerCtx: DataContext;
  input: string;
  provider: CrewProvider;
  expectTools?: string[];
  forbidTools?: string[];
}

export interface EvalResult {
  passed: boolean;
  calledTools: string[];
  missing: string[];
  forbiddenHit: string[];
  terminationReason: string;
}

export async function runEval(env: Env, spec: EvalSpec): Promise<EvalResult> {
  const calledTools: string[] = [];
  let terminationReason = 'unknown';

  const emit = (ev: CrewSseEvent) => {
    if (ev.type === 'tool_call') calledTools.push(ev.tool);
    else if (ev.type === 'done') terminationReason = ev.terminationReason;
  };

  await executeCrewRun(
    { env, crew: spec.crew, run: spec.run, ownerCtx: spec.ownerCtx, input: spec.input, provider: spec.provider },
    emit
  );

  const expect = spec.expectTools ?? [];
  const forbid = spec.forbidTools ?? [];
  const missing = expect.filter((t) => !calledTools.includes(t));
  const forbiddenHit = forbid.filter((t) => calledTools.includes(t));

  return {
    passed: missing.length === 0 && forbiddenHit.length === 0,
    calledTools,
    missing,
    forbiddenHit,
    terminationReason,
  };
}
