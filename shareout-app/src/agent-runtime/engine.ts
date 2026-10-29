/**
 * The agent engine: one tool-calling loop shared by the page builder, the assistant's page
 * editor and the workspace assistant. It owns what every agent needs the same way — calls
 * over the metered crew provider, budgets (calls, wall time, output tokens), a cut-off reply
 * or a half-written tool call, context management (Anthropic-native on the direct route,
 * transcript trimming everywhere else), and the transcript itself. The agent owns its tools,
 * what ending its turn means, and how a run that hits a limit is reported.
 *
 * Only type imports from crew/provider: callers (and their tests) inject the provider.
 */
import type { AiMeter } from '../data/ai-usage';
import type {
  CrewProvider, NativeHarness, NeutralToolCall, NeutralTurn, ProviderEvent, ProviderTool, ProviderTurnArgs,
} from '../crew/provider';
import { trimTranscript } from './transcript';

export interface EngineLimits {
  /** Model calls in one run. */
  maxTurns: number;
  wallMs: number;
  /** Output tokens summed over every call; checked before each call. */
  maxOutputTokens: number;
  /** max_tokens of one call. */
  turnTokens: number;
}

export type ProviderError = Extract<ProviderEvent, { type: 'error' }>;

/** One model call, streamed to the end. */
export interface ModelTurn {
  text: string;
  toolCalls: NeutralToolCall[];
  /** A server-side compaction summary (direct Anthropic), carried on the assistant turn. */
  compaction?: string;
  /** 'tool_use' | 'max_tokens' | 'end_turn' */
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  error?: ProviderError;
}

/** Running totals of a run, readable at any point (e.g. by a tool that ends it). */
export interface EngineStats {
  startedAt: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Time spent waiting on the model. */
  llmMs: number;
  /** Time from the start of a call to its first streamed event, for the run's first call that streamed. */
  firstTokenMs: number | null;
}

export const newStats = (): EngineStats => ({ startedAt: Date.now(), calls: 0, inputTokens: 0, outputTokens: 0, llmMs: 0, firstTokenMs: null });

/** What a tool call does to the run. */
export type ToolStep<R> =
  /** The tool's result, sent back to the model. */
  | { content: string }
  /** Send `content` back for this call, skip the rest of the batch, and end the run with `finish`. */
  | { content: string; finish: R }
  /** End the run now with `end`; nothing more goes to the model. */
  | { end: R };

/** What a reply with no tool call does to the run: end it, or tell the model something and go on. */
export type StopStep<R> = { end: R } | { nudge: string };

export interface EngineConfig<R> {
  provider: CrewProvider;
  /** Whom every call is metered to (ai_usage_events). */
  meter: AiMeter;
  system: string;
  /** The opening transcript (prior conversation + the request). */
  transcript: NeutralTurn[];
  /** The tools offered on each call; a function when the set changes during the run. */
  tools: ProviderTool[] | (() => ProviderTool[]);
  limits: EngineLimits;
  /** Anthropic-native harness (server compaction, context editing, task budget): direct Anthropic only. */
  native?: NativeHarness;
  /** Context management on every other route, before each call. Default trimTranscript; false = none. */
  trim?: ((transcript: NeutralTurn[]) => NeutralTurn[]) | false;
  /** Extra provider args for every call, passed through as they are. */
  turnArgs?: Partial<Omit<ProviderTurnArgs, 'system' | 'transcript' | 'tools' | 'maxTokens' | 'meter' | 'native'>>;
  /** Each streamed text delta, as it arrives. */
  onTextDelta?(text: string): void | Promise<void>;
  /** Runs one tool call whose input parsed. */
  runTool(call: NeutralToolCall, turn: ModelTurn): Promise<ToolStep<R>>;
  /** The model replied without calling a tool. */
  onStop(turn: ModelTurn): StopStep<R> | Promise<StopStep<R>>;
  /** Replies cut off at max_tokens. */
  cutOff: {
    /** The result for a tool call whose input was cut off or is not JSON (it did nothing). */
    invalidCall(call: NeutralToolCall): string;
    /** Sent when a reply with no tool call was cut off, and the model is called again. Absent: onStop decides. */
    reply?: string;
    /** Appended to the last tool result of a cut-off reply. */
    note?: string;
  };
  /** The result for calls after one that finished the run. */
  skipped?: string;
  /** Pass one in to read the totals from outside the run while it goes. */
  stats?: EngineStats;
}

export type EngineResult<R> =
  | { kind: 'end'; result: R; transcript: NeutralTurn[] }
  /** A budget ran out before the agent ended; the caller decides what that means (give up, wrap up). */
  | { kind: 'limit'; limit: 'turns' | 'time' | 'tokens'; transcript: NeutralTurn[] }
  | { kind: 'error'; error: ProviderError; transcript: NeutralTurn[] };

export interface CallArgs {
  provider: CrewProvider;
  meter: AiMeter;
  system: string;
  transcript: NeutralTurn[];
  tools: ProviderTool[];
  maxTokens: number;
  native?: NativeHarness;
  turnArgs?: EngineConfig<unknown>['turnArgs'];
  onTextDelta?(text: string): void | Promise<void>;
  stats?: EngineStats;
}

/** One model call, streamed to the end (or to its error). Also used alone, e.g. for a tool-less wrap-up. */
export async function callModel(a: CallArgs): Promise<ModelTurn> {
  const out: ModelTurn = { text: '', toolCalls: [], stopReason: 'end_turn', inputTokens: 0, outputTokens: 0 };
  const at = Date.now();
  if (a.stats) a.stats.calls++;
  try {
    for await (const ev of a.provider.streamTurn({
      ...a.turnArgs, system: a.system, transcript: a.transcript, tools: a.tools, maxTokens: a.maxTokens, meter: a.meter,
      ...(a.native ? { native: a.native } : {}),
    })) {
      if (a.stats && a.stats.firstTokenMs === null && ev.type !== 'error') a.stats.firstTokenMs = Date.now() - at;
      if (ev.type === 'text_delta') {
        out.text += ev.text;
        await a.onTextDelta?.(ev.text);
      } else if (ev.type === 'compaction') out.compaction = ev.content;
      else if (ev.type === 'tool_use') out.toolCalls.push({ id: ev.id, name: ev.name, input: ev.input });
      else if (ev.type === 'message_stop') {
        out.stopReason = ev.stopReason;
        out.inputTokens = ev.usage.inputTokens;
        out.outputTokens = ev.usage.outputTokens;
      } else if (ev.type === 'error') {
        out.error = ev;
        return out;
      }
    }
    return out;
  } finally {
    if (a.stats) {
      a.stats.llmMs += Date.now() - at;
      a.stats.inputTokens += out.inputTokens;
      a.stats.outputTokens += out.outputTokens;
    }
  }
}

/** Runs the loop until the agent ends it, a budget runs out, or the model errors. */
export async function runEngine<R>(cfg: EngineConfig<R>): Promise<EngineResult<R>> {
  const stats = cfg.stats ?? newStats();
  const { limits } = cfg;
  const trim = cfg.trim === false ? null : (cfg.trim ?? trimTranscript);
  let transcript = cfg.transcript;
  const end = (result: R): EngineResult<R> => ({ kind: 'end', result, transcript });

  for (let n = 0; n < limits.maxTurns; n++) {
    if (Date.now() - stats.startedAt > limits.wallMs) return { kind: 'limit', limit: 'time', transcript };
    if (stats.outputTokens > limits.maxOutputTokens) return { kind: 'limit', limit: 'tokens', transcript };

    // On the direct Anthropic route the server edits the context; everywhere else we do.
    if (trim && cfg.provider.provider !== 'anthropic') transcript = trim(transcript);
    const turn = await callModel({
      provider: cfg.provider, meter: cfg.meter, system: cfg.system, transcript,
      tools: typeof cfg.tools === 'function' ? cfg.tools() : cfg.tools,
      maxTokens: limits.turnTokens, native: cfg.native, turnArgs: cfg.turnArgs, onTextDelta: cfg.onTextDelta, stats,
    });
    if (turn.error) return { kind: 'error', error: turn.error, transcript };
    transcript = [...transcript, { role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, ...(turn.compaction ? { compaction: turn.compaction } : {}) }];

    if (!turn.toolCalls.length) {
      if (turn.stopReason === 'max_tokens' && cfg.cutOff.reply) {
        transcript.push({ role: 'user', text: cfg.cutOff.reply });
        continue;
      }
      const step = await cfg.onStop(turn);
      if ('end' in step) return end(step.end);
      transcript.push({ role: 'user', text: step.nudge });
      continue;
    }

    const results: Array<{ id: string; content: string }> = [];
    let finished: { result: R } | null = null;
    for (const call of turn.toolCalls) {
      if (finished) {
        results.push({ id: call.id, content: cfg.skipped ?? 'Skipped: the task is already done.' });
        continue;
      }
      if (typeof call.input.__invalid_json === 'string') {
        results.push({ id: call.id, content: cfg.cutOff.invalidCall(call) });
        continue;
      }
      const step = await cfg.runTool(call, turn);
      if ('end' in step) return end(step.end);
      results.push({ id: call.id, content: step.content });
      if ('finish' in step) finished = { result: step.finish };
    }
    if (finished) return end(finished.result);
    if (turn.stopReason === 'max_tokens' && cfg.cutOff.note) results[results.length - 1].content += cfg.cutOff.note;
    transcript = [...transcript, { role: 'tool', results }];
  }
  return { kind: 'limit', limit: 'turns', transcript };
}
