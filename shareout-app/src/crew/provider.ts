import type { Env } from '../types';
import { meterAiCall, type AiMeter } from '../data/ai-usage';
import { workspaceBudgetBlock } from '../data/ai-budget';
import { reportProviderBilling } from '../data/agent/ai-ops-alerts';
import { getBuildChain, isEnvProvider, isProviderLevelStatus, providerHeaders, type AIConfig } from '../data/agent/anthropic';
import { logCrewProviderFailure, userFacingCrewProviderError } from './errors';
import { GATEWAY_CACHING_PARAMS, anthropicEffortParams, gatewayReasoningParams, thinkingOffParams, type ReasoningEffort } from '../data/agent/models';

// Provider-neutral tool-calling turn. The run loop keeps a neutral transcript;
// each provider serializes it to its own wire format: the OpenAI-compatible
// adapter (Vercel AI Gateway / OpenAI function calling) and the native Anthropic
// Messages API. getCrewProvider chains them for failover.

export interface ProviderTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Stream the tool's arguments as they are written (Anthropic route); the caller validates the parsed input. */
  eagerInput?: boolean;
}

export interface NeutralToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type NeutralTurn =
  | { role: 'user'; text: string }
  /** `compaction`: a server-side summary block (Anthropic route only), sent back verbatim ahead of the text. */
  | { role: 'assistant'; text: string; toolCalls: NeutralToolCall[]; compaction?: string }
  | { role: 'tool'; results: Array<{ id: string; content: string }> };

/**
 * Anthropic-native harness features. Honoured only by AnthropicCrewProvider (a direct
 * ANTHROPIC_API_KEY call); every other route ignores them and the caller trims its own transcript.
 */
export interface NativeHarness {
  /** Server-side compaction once the prompt passes this many tokens (min 50k). */
  compactAtTokens?: number;
  /** Clear old tool results once the prompt passes `triggerTokens`, keeping the last `keep` pairs. */
  clearToolUses?: { triggerTokens: number; keep: number; clearInputs?: boolean };
  /** Advisory token budget for the whole agentic loop (min 20k). */
  taskBudgetTokens?: number;
}

export interface ProviderTurnArgs {
  system: string;
  transcript: NeutralTurn[];
  tools: ProviderTool[];
  maxTokens: number;
  /** Whom each model turn is metered to (ai_usage_events). */
  meter: AiMeter;
  native?: NativeHarness;
  /** Reasoning effort for this turn (page builds). Unset: the gateway's lowest, nothing sent to Anthropic. */
  effort?: ReasoningEffort;
}

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  /** A server-side compaction summary; keep it on the assistant turn so the next request carries it back. */
  | { type: 'compaction'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  /** stopReason: 'tool_use' | 'max_tokens' (output cut off at the cap; a tool call may be half-written) | 'end_turn'. */
  | { type: 'message_stop'; stopReason: string; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; error: string; retryable?: boolean; code?: string };

/** A refused turn when the workspace's monthly AI budget is spent; null otherwise. */
async function budgetRefusal(env: Env, meter: AiMeter): Promise<ProviderEvent | null> {
  const blocked = await workspaceBudgetBlock(env, meter.workspaceId);
  return blocked ? { type: 'error', error: blocked.message, code: blocked.code } : null;
}

export interface CrewProvider {
  readonly provider: string;
  readonly model: string;
  streamTurn(args: ProviderTurnArgs): AsyncGenerator<ProviderEvent>;
}

/** Parsed JSON payloads of an SSE body's `data:` lines. Malformed lines are skipped. */
async function* sseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          yield JSON.parse(data);
        } catch {
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseToolInput(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { __invalid_json: raw.slice(0, 500) };
  }
}

/** Opens the provider's SSE stream, or says why not (logged for /admin health, safe to show). */
async function openTurn(
  env: Env,
  cfg: AIConfig,
  url: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<{ body: ReadableStream<Uint8Array> } | { event: ProviderEvent; status?: number }> {
  const fields = { provider: cfg.provider, model: cfg.model };
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { ...providerHeaders(cfg), ...extraHeaders }, body: JSON.stringify(body) });
  } catch (err) {
    logCrewProviderFailure(env, fields, err);
    return { event: { type: 'error', error: userFacingCrewProviderError(err), retryable: true } };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logCrewProviderFailure(
      env,
      { ...fields, httpStatus: response.status },
      new Error(`AI provider HTTP ${response.status}: ${text.slice(0, 2000)}`),
    );
    if (isEnvProvider(env, cfg)) await reportProviderBilling(env, cfg.provider, cfg.model, response.status, text);
    return {
      status: response.status,
      event: { type: 'error', error: userFacingCrewProviderError(undefined, response.status), retryable: isProviderLevelStatus(response.status) },
    };
  }
  if (!response.body) {
    logCrewProviderFailure(env, fields, new Error('No response body from AI provider'));
    return { event: { type: 'error', error: userFacingCrewProviderError(), retryable: true } };
  }
  return { body: response.body };
}

/** Shared HTTP/transport failure handling: yields a safe error event, or hands back the stream. */
async function* requestTurn(
  env: Env,
  cfg: AIConfig,
  url: string,
  body: Record<string, unknown>,
): AsyncGenerator<ProviderEvent, ReadableStream<Uint8Array> | null> {
  const opened = await openTurn(env, cfg, url, body);
  if ('body' in opened) return opened.body;
  yield opened.event;
  return null;
}

/** Both the request's own output_config (effort) and the native harness's (task budget), as one field. */
function mergedOutputConfig(plain: Record<string, unknown>, extra: Record<string, unknown>): { output_config?: Record<string, unknown> } {
  if (!plain.output_config && !extra.output_config) return {};
  return { output_config: { ...(plain.output_config as object | undefined), ...(extra.output_config as object | undefined) } };
}

export class OpenAICompatCrewProvider implements CrewProvider {
  readonly provider: string;
  readonly model: string;

  constructor(
    private cfg: AIConfig,
    private env: Env,
  ) {
    this.provider = cfg.provider;
    this.model = cfg.model;
  }

  private toWireMessages(system: string, transcript: NeutralTurn[]): unknown[] {
    const msgs: unknown[] = [{ role: 'system', content: system }];
    for (const turn of transcript) {
      if (turn.role === 'user') {
        msgs.push({ role: 'user', content: turn.text });
      } else if (turn.role === 'assistant') {
        const m: Record<string, unknown> = { role: 'assistant', content: turn.text || null };
        if (turn.toolCalls.length) {
          m.tool_calls = turn.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          }));
        }
        msgs.push(m);
      } else {
        for (const r of turn.results) {
          msgs.push({ role: 'tool', tool_call_id: r.id, content: r.content });
        }
      }
    }
    return msgs;
  }

  async *streamTurn(args: ProviderTurnArgs): AsyncGenerator<ProviderEvent> {
    const refused = await budgetRefusal(this.env, args.meter);
    if (refused) { yield refused; return; }
    const wireTools = args.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const body = yield* requestTurn(this.env, this.cfg, `${this.cfg.baseUrl}/chat/completions`, {
      model: this.model,
      max_tokens: args.maxTokens,
      messages: this.toWireMessages(args.system, args.transcript),
      ...(wireTools.length ? { tools: wireTools } : {}),
      ...(this.provider === 'vercel-gateway' ? { ...gatewayReasoningParams(this.model, args.effort), ...GATEWAY_CACHING_PARAMS } : {}),
      stream: true,
      stream_options: { include_usage: true },
    });
    if (!body) return;

    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let stopReason = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;
    let providerRef: string | null = null;

    for await (const event of sseJson(body)) {
      if (!providerRef && this.cfg.provider === 'vercel-gateway' && typeof event.id === 'string') providerRef = event.id;
      const choice = event.choices?.[0];
      if (choice?.delta?.content) {
        yield { type: 'text_delta', text: choice.delta.content };
      }
      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          let acc = toolAcc.get(idx);
          if (!acc) {
            acc = { id: '', name: '', args: '' };
            toolAcc.set(idx, acc);
          }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
        }
      }
      if (choice?.finish_reason) stopReason = choice.finish_reason;
      if (event.usage) {
        inputTokens = event.usage.prompt_tokens ?? inputTokens;
        outputTokens = event.usage.completion_tokens ?? outputTokens;
      }
    }

    let sawTool = false;
    for (const acc of toolAcc.values()) {
      if (!acc.name) continue;
      sawTool = true;
      yield { type: 'tool_use', id: acc.id || acc.name, name: acc.name, input: parseToolInput(acc.args) };
    }

    await meterAiCall(this.env, args.meter, this.model, inputTokens, outputTokens, providerRef);
    yield {
      type: 'message_stop',
      stopReason: stopReason === 'length' ? 'max_tokens' : stopReason === 'tool_calls' || sawTool ? 'tool_use' : 'end_turn',
      usage: { inputTokens, outputTokens },
    };
  }
}

/** Native Anthropic Messages API adapter (ANTHROPIC_API_KEY). */
export class AnthropicCrewProvider implements CrewProvider {
  readonly provider: string;
  readonly model: string;

  constructor(
    private cfg: AIConfig,
    private env: Env,
  ) {
    this.provider = cfg.provider;
    this.model = cfg.model;
  }

  private toWireMessages(transcript: NeutralTurn[]): unknown[] {
    const msgs: unknown[] = [];
    for (const turn of transcript) {
      if (turn.role === 'user') {
        msgs.push({ role: 'user', content: turn.text });
      } else if (turn.role === 'assistant') {
        const content: unknown[] = [];
        if (turn.compaction) content.push({ type: 'compaction', content: turn.compaction });
        if (turn.text) content.push({ type: 'text', text: turn.text });
        for (const tc of turn.toolCalls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
        if (content.length) msgs.push({ role: 'assistant', content });
      } else {
        msgs.push({
          role: 'user',
          content: turn.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })),
        });
      }
    }
    return msgs;
  }

  /** Set once the API refuses the beta features, so later turns skip the failed attempt. */
  private nativeOff = false;

  /** Request fields + beta headers for the native harness features that were asked for. */
  private nativeParts(native: NativeHarness | undefined): { body: Record<string, unknown>; betas: string[] } | null {
    if (!native) return null;
    const edits: Record<string, unknown>[] = [];
    const betas: string[] = [];
    const body: Record<string, unknown> = {};
    if (native.clearToolUses) {
      edits.push({
        type: 'clear_tool_uses_20250919',
        trigger: { type: 'input_tokens', value: native.clearToolUses.triggerTokens },
        keep: { type: 'tool_uses', value: native.clearToolUses.keep },
        ...(native.clearToolUses.clearInputs ? { clear_tool_inputs: true } : {}),
      });
      betas.push('context-management-2025-06-27');
    }
    if (native.compactAtTokens) {
      edits.push({ type: 'compact_20260112', trigger: { type: 'input_tokens', value: Math.max(50_000, native.compactAtTokens) } });
      betas.push('compact-2026-01-12');
    }
    if (edits.length) body.context_management = { edits };
    if (native.taskBudgetTokens) {
      // Merged with `plain`'s output_config (effort) in streamTurn: the spread there would replace it.
      body.output_config = { task_budget: { type: 'tokens', total: Math.max(20_000, native.taskBudgetTokens) } };
      betas.push('task-budgets-2026-03-13');
    }
    return betas.length ? { body, betas } : null;
  }

  async *streamTurn(args: ProviderTurnArgs): AsyncGenerator<ProviderEvent> {
    const refused = await budgetRefusal(this.env, args.meter);
    if (refused) { yield refused; return; }
    const plain: Record<string, unknown> = {
      model: this.model,
      max_tokens: args.maxTokens,
      system: args.system,
      messages: this.toWireMessages(args.transcript),
      ...(args.tools.length
        ? {
            tools: args.tools.map((t) => ({
              name: t.name, description: t.description, input_schema: t.input_schema,
              ...(t.eagerInput ? { eager_input_streaming: true } : {}),
            })),
          }
        : {}),
      ...thinkingOffParams(this.model),
      ...(args.effort ? anthropicEffortParams(this.model, args.effort) : {}),
      cache_control: { type: 'ephemeral' },
      stream: true,
    };
    const url = `${this.cfg.baseUrl}/messages`;
    // Beta features can be refused (model or account without access): retry once on a plain
    // request rather than fail the build over an optimisation.
    const native = this.nativeOff ? null : this.nativeParts(args.native);
    let opened = native
      ? await openTurn(this.env, this.cfg, url, { ...plain, ...native.body, ...mergedOutputConfig(plain, native.body) }, { 'anthropic-beta': native.betas.join(',') })
      : await openTurn(this.env, this.cfg, url, plain);
    if (native && !('body' in opened) && opened.status === 400) {
      this.nativeOff = true;
      opened = await openTurn(this.env, this.cfg, url, plain);
    }
    if (!('body' in opened)) { yield opened.event; return; }
    const body = opened.body;

    const toolAcc = new Map<number, { id: string; name: string; json: string }>();
    let stopReason = 'end_turn';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of sseJson(body)) {
      if (event.type === 'error') {
        logCrewProviderFailure(
          this.env,
          { provider: this.provider, model: this.model },
          new Error(`AI provider stream error: ${event.error?.type ?? 'unknown'}`),
        );
        yield { type: 'error', error: userFacingCrewProviderError(), retryable: true };
        return;
      }
      if (event.type === 'message_start') {
        inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
      } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        toolAcc.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: '' });
      } else if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          yield { type: 'text_delta', text: event.delta.text };
        } else if (event.delta?.type === 'compaction_delta' && typeof event.delta.content === 'string') {
          yield { type: 'compaction', content: event.delta.content };
        } else if (event.delta?.type === 'input_json_delta') {
          const acc = toolAcc.get(event.index);
          if (acc) acc.json += event.delta.partial_json ?? '';
        }
      } else if (event.type === 'message_delta') {
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        outputTokens = event.usage?.output_tokens ?? outputTokens;
        // Compaction runs its own model call; the top-level counts leave it out, so add it for the meter.
        for (const it of Array.isArray(event.usage?.iterations) ? event.usage.iterations : []) {
          if (it?.type !== 'compaction') continue;
          inputTokens += it.input_tokens ?? 0;
          outputTokens += it.output_tokens ?? 0;
        }
      }
    }

    for (const acc of toolAcc.values()) {
      yield { type: 'tool_use', id: acc.id, name: acc.name, input: parseToolInput(acc.json) };
    }

    await meterAiCall(this.env, args.meter, this.model, inputTokens, outputTokens);
    yield {
      type: 'message_stop',
      stopReason: stopReason === 'tool_use' || stopReason === 'max_tokens' ? stopReason : 'end_turn',
      usage: { inputTokens, outputTokens },
    };
  }
}

/**
 * Tries each provider in order. Fails over only on a retryable (provider-level) error
 * before anything streamed — streamed text can't be un-emitted.
 */
export class FailoverCrewProvider implements CrewProvider {
  private active: CrewProvider;

  constructor(private providers: CrewProvider[]) {
    this.active = providers[0];
  }

  get provider(): string {
    return this.active.provider;
  }

  get model(): string {
    return this.active.model;
  }

  async *streamTurn(args: ProviderTurnArgs): AsyncGenerator<ProviderEvent> {
    for (let i = 0; i < this.providers.length; i++) {
      this.active = this.providers[i];
      const isLast = i === this.providers.length - 1;
      let emitted = false;
      let failedOver = false;
      for await (const event of this.active.streamTurn(args)) {
        if (event.type === 'error' && event.retryable && !emitted && !isLast) {
          failedOver = true;
          break;
        }
        emitted = true;
        yield event;
      }
      if (!failedOver) return;
    }
  }
}

/** A crew provider for one fixed config (e.g. a workspace's BYO key — never failed over to our keys). */
export function crewProviderFor(env: Env, cfg: AIConfig): CrewProvider {
  return cfg.provider === 'anthropic' ? new AnthropicCrewProvider(cfg, env) : new OpenAICompatCrewProvider(cfg, env);
}

/** Resolve the crew provider over every configured AI provider, in failover order.
 *  `gatewayModel` overrides the Vercel AI Gateway model (workspace or instance choice);
 *  `anthropicModel` overrides the model on the native Anthropic entry. */
export function getCrewProvider(env: Env, gatewayModel?: string | null, anthropicModel?: string | null): CrewProvider | null {
  const providers = getBuildChain(env, gatewayModel)
    .map((cfg) => (anthropicModel && cfg.provider === 'anthropic' ? { ...cfg, model: anthropicModel } : cfg))
    .map((cfg) => crewProviderFor(env, cfg));
  if (providers.length === 0) return null;
  return providers.length === 1 ? providers[0] : new FailoverCrewProvider(providers);
}
