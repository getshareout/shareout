import type { Env } from '../types';
import { getBuildConfig, type AIConfig } from '../data/agent/anthropic';

// Provider-neutral tool-calling turn. The run loop keeps a neutral transcript;
// each provider serializes it to its own wire format. Phase 0 ships the
// OpenAI-compatible adapter (Vercel AI Gateway → Claude/OpenAI with function
// calling), the working LLM path in production.

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
  | { type: 'error'; error: string };

export interface CrewProvider {
  readonly provider: string;
  readonly model: string;
  streamTurn(args: ProviderTurnArgs): AsyncGenerator<ProviderEvent>;
}

export class OpenAICompatCrewProvider implements CrewProvider {
  readonly provider: string;
  readonly model: string;

  constructor(private cfg: AIConfig) {
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

    let response: Response;
    try {
      response = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: args.maxTokens,
          messages: this.toWireMessages(args.system, args.transcript),
          tools: wireTools,
          stream: true,
          stream_options: { include_usage: true },
        }),
      });
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err.message : 'request failed' };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      yield { type: 'error', error: `AI gateway error ${response.status}: ${text.slice(0, 500)}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let stopReason = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;

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

          let event: Record<string, any>;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

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
      }
    } finally {
      reader.releaseLock();
    }

    for (const acc of toolAcc.values()) {
      if (!acc.name) continue;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(acc.args || '{}');
      } catch {
        /* malformed arguments → empty object */
      }
      yield { type: 'tool_use', id: acc.id || acc.name, name: acc.name, input };
    }

    yield {
      type: 'message_stop',
      stopReason: stopReason === 'tool_calls' ? 'tool_use' : 'end_turn',
      usage: { inputTokens, outputTokens },
    };
  }
}

/** Resolve the crew provider: Vercel AI Gateway (strong Claude model), else the default provider. */
export function getCrewProvider(_env: Env): CrewProvider | null {
  const cfg = getBuildConfig(_env);
  if (!cfg) return null;
  return new OpenAICompatCrewProvider(cfg);
}
