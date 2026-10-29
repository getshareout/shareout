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

/** How hard a model thinks on a call. Chat and crew run at the lowest; page builds choose (BUILD_EFFORT). */
export type ReasoningEffort = 'low' | 'medium' | 'high';

export const DEFAULT_BUILD_EFFORT: ReasoningEffort = 'medium';

/** BUILD_EFFORT (low | medium | high). Anything else is a typo: fall back to the default rather than fail a build. */
export function parseBuildEffort(raw: string | undefined): ReasoningEffort {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'low' || v === 'medium' || v === 'high' ? v : DEFAULT_BUILD_EFFORT;
}

/** The Vercel AI Gateway counterpart of thinkingOffParams on its OpenAI-compatible
 *  endpoint: with no `reasoning` field Claude 5.x thinks at its default effort on every
 *  turn. They can't turn thinking off there, so ask for the lowest effort unless the
 *  caller picks one. */
export function gatewayReasoningParams(model: string, effort: ReasoningEffort = 'low'): { reasoning?: { effort: string } } {
  return /claude-(sonnet|opus)-5/.test(model) ? { reasoning: { effort } } : {};
}

/** The direct-Anthropic equivalent: `output_config.effort`, valid next to the `between_tools`
 *  thinking field thinkingOffParams sends (Sonnet 5.5 allows low..high with it). Models
 *  outside Sonnet/Opus 5 (Haiku) reject the field, so they get none. */
export function anthropicEffortParams(model: string, effort: ReasoningEffort): { output_config?: { effort: string } } {
  return /claude-(sonnet|opus)-5/.test(model) ? { output_config: { effort } } : {};
}

/** Vercel AI Gateway prompt caching: the gateway adds Anthropic cache markers itself
 *  (providers that need none ignore it), so the system prompt + tools are reused across
 *  a turn's tool rounds and a thread's turns. */
export const GATEWAY_CACHING_PARAMS = { providerOptions: { gateway: { caching: 'auto' } } } as const;

/** Current Claude models reject a non-default temperature; send it only to other models. */
export function temperatureParams(model: string, temperature: number): { temperature?: number } {
  return /claude/.test(model) ? {} : { temperature };
}
