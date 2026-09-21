import type { Env } from '../types';
import { getBuildChain, isProviderLevelStatus, providerHeaders, type AIConfig } from '../data/agent/anthropic';
import { logCrewProviderFailure, userFacingCrewProviderError } from './errors';

// Provider-neutral tool-calling turn. The run loop keeps a neutral transcript;
// each provider serializes it to its own wire format: the OpenAI-compatible
// adapter (Vercel AI Gateway / OpenAI function calling) and the native Anthropic
// Messages API. getCrewProvider chains them for failover.

export interface ProviderTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface NeutralToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type NeutralTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: NeutralToolCall[] }
  | { role: 'tool'; results: Array<{ id: string; content: string }> };

export interface ProviderTurnArgs {
  system: string;
  transcript: NeutralTurn[];
  tools: ProviderTool[];
  maxTokens: number;
}

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'message_stop'; stopReason: string; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; error: string; retryable?: boolean };

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
    return {};
  }
}

/** Shared HTTP/transport failure handling: log for /admin health, yield a safe error. */
async function* requestTurn(
  env: Env,
  cfg: AIConfig,
  url: string,
  body: Record<string, unknown>,
): AsyncGenerator<ProviderEvent, ReadableStream<Uint8Array> | null> {
  const fields = { provider: cfg.provider, model: cfg.model };
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: providerHeaders(cfg), body: JSON.stringify(body) });
  } catch (err) {
    logCrewProviderFailure(env, fields, err);
    yield { type: 'error', error: userFacingCrewProviderError(err), retryable: true };
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logCrewProviderFailure(
      env,
      { ...fields, httpStatus: response.status },
      new Error(`AI provider HTTP ${response.status}: ${text.slice(0, 2000)}`),
    );
    yield {
      type: 'error',
      error: userFacingCrewProviderError(undefined, response.status),
      retryable: isProviderLevelStatus(response.status),
    };
    return null;
  }
  if (!response.body) {
    logCrewProviderFailure(env, fields, new Error('No response body from AI provider'));
    yield { type: 'error', error: userFacingCrewProviderError(), retryable: true };
    return null;
  }
  return response.body;
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
    const wireTools = args.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const body = yield* requestTurn(this.env, this.cfg, `${this.cfg.baseUrl}/chat/completions`, {
      model: this.model,
      max_tokens: args.maxTokens,
      messages: this.toWireMessages(args.system, args.transcript),
      tools: wireTools,
      stream: true,
      stream_options: { include_usage: true },
    });
    if (!body) return;

    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let stopReason = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of sseJson(body)) {
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

    for (const acc of toolAcc.values()) {
      if (!acc.name) continue;
      yield { type: 'tool_use', id: acc.id || acc.name, name: acc.name, input: parseToolInput(acc.args) };
    }

    yield {
      type: 'message_stop',
      stopReason: stopReason === 'tool_calls' ? 'tool_use' : 'end_turn',
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

  async *streamTurn(args: ProviderTurnArgs): AsyncGenerator<ProviderEvent> {
    const body = yield* requestTurn(this.env, this.cfg, `${this.cfg.baseUrl}/messages`, {
      model: this.model,
      max_tokens: args.maxTokens,
      system: args.system,
      messages: this.toWireMessages(args.transcript),
      tools: args.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      thinking: { type: 'disabled' },
      cache_control: { type: 'ephemeral' },
      stream: true,
    });
    if (!body) return;

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
        } else if (event.delta?.type === 'input_json_delta') {
          const acc = toolAcc.get(event.index);
          if (acc) acc.json += event.delta.partial_json ?? '';
        }
      } else if (event.type === 'message_delta') {
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        outputTokens = event.usage?.output_tokens ?? outputTokens;
      }
    }

    for (const acc of toolAcc.values()) {
      yield { type: 'tool_use', id: acc.id, name: acc.name, input: parseToolInput(acc.json) };
    }

    yield {
      type: 'message_stop',
      stopReason: stopReason === 'tool_use' ? 'tool_use' : 'end_turn',
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

/** Resolve the crew provider over every configured AI provider, in failover order.
 *  `gatewayModel` overrides the Vercel AI Gateway model (workspace or instance choice). */
export function getCrewProvider(env: Env, gatewayModel?: string | null): CrewProvider | null {
  const providers = getBuildChain(env, gatewayModel).map((cfg) =>
    cfg.provider === 'anthropic' ? new AnthropicCrewProvider(cfg, env) : new OpenAICompatCrewProvider(cfg, env),
  );
  if (providers.length === 0) return null;
  return providers.length === 1 ? providers[0] : new FailoverCrewProvider(providers);
}
