// Single source of truth for the model ids ShareOut calls. First-party Anthropic ids
// and Vercel AI Gateway slugs differ (e.g. Haiku), so each Claude model carries both.

export const OPENAI_CHAT_MODEL = 'gpt-4o';

export const CLAUDE_OPUS = { id: 'claude-opus-5', gateway: 'anthropic/claude-opus-5' } as const;
export const CLAUDE_SONNET = { id: 'claude-sonnet-5-5', gateway: 'anthropic/claude-sonnet-5.5' } as const;
export const CLAUDE_HAIKU = { id: 'claude-haiku-4-5-20251001', gateway: 'anthropic/claude-haiku-4.5' } as const;

/** Default Claude model for agents, builds and per-artifact chat. */
export const DEFAULT_CLAUDE_MODEL = CLAUDE_SONNET;

/** The Claude model a stored id names (first-party id, gateway slug, or the undated
 *  alias), or null for an id ShareOut no longer serves. */
export function claudeModelById(id: string | null | undefined): typeof CLAUDE_OPUS | typeof CLAUDE_SONNET | typeof CLAUDE_HAIKU | null {
  if (!id) return null;
  return [CLAUDE_OPUS, CLAUDE_SONNET, CLAUDE_HAIKU].find((m) => m.id === id || m.gateway === id || m.id.replace(/-\d{8}$/, '') === id) ?? null;
}

/** Request fields that turn thinking off on a direct Anthropic call, per model:
 *  Sonnet 5.5 rejects `disabled` and takes `between_tools`; Opus 5.5 and Fable
 *  can't turn it off at all; older models take `disabled`. */
export function thinkingOffParams(model: string): { thinking?: { type: string } } {
  if (/sonnet-5[-.]5/.test(model)) return { thinking: { type: 'between_tools' } };
  if (/opus-5[-.]5|fable|mythos/.test(model)) return {};
  return { thinking: { type: 'disabled' } };
}

/** The Vercel AI Gateway counterpart of thinkingOffParams on its OpenAI-compatible
 *  endpoint: with no `reasoning` field Claude 5.x thinks at its default effort on every
 *  turn. They can't turn thinking off there, so ask for the lowest effort. */
export function gatewayReasoningParams(model: string): { reasoning?: { effort: string } } {
  return /claude-(sonnet|opus)-5/.test(model) ? { reasoning: { effort: 'low' } } : {};
}

/** Vercel AI Gateway prompt caching: the gateway adds Anthropic cache markers itself
 *  (providers that need none ignore it), so the system prompt + tools are reused across
 *  a turn's tool rounds and a thread's turns. */
export const GATEWAY_CACHING_PARAMS = { providerOptions: { gateway: { caching: 'auto' } } } as const;

/** Current Claude models reject a non-default temperature; send it only to other models. */
export function temperatureParams(model: string, temperature: number): { temperature?: number } {
  return /claude/.test(model) ? {} : { temperature };
}
