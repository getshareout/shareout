// Single source of truth for the model ids ShareOut calls. First-party Anthropic ids
// and Vercel AI Gateway slugs differ (e.g. Haiku), so each Claude model carries both.

export const OPENAI_CHAT_MODEL = 'gpt-4o';

export const CLAUDE_OPUS = { id: 'claude-opus-5', gateway: 'anthropic/claude-opus-5' } as const;
export const CLAUDE_SONNET = { id: 'claude-sonnet-5-5', gateway: 'anthropic/claude-sonnet-5.5' } as const;
export const CLAUDE_HAIKU = { id: 'claude-haiku-4-5-20251001', gateway: 'anthropic/claude-haiku-4.5' } as const;

/** Default Claude model for agents, builds and per-artifact chat. */
export const DEFAULT_CLAUDE_MODEL = CLAUDE_SONNET;

/** Request fields that turn thinking off on a direct Anthropic call, per model:
 *  Sonnet 5.5 rejects `disabled` and takes `between_tools`; Opus 5.5 and Fable
 *  can't turn it off at all; older models take `disabled`. */
export function thinkingOffParams(model: string): { thinking?: { type: string } } {
  if (/sonnet-5[-.]5/.test(model)) return { thinking: { type: 'between_tools' } };
  if (/opus-5[-.]5|fable|mythos/.test(model)) return {};
  return { thinking: { type: 'disabled' } };
}

/** Current Claude models reject a non-default temperature; send it only to other models. */
export function temperatureParams(model: string, temperature: number): { temperature?: number } {
  return /claude/.test(model) ? {} : { temperature };
}
