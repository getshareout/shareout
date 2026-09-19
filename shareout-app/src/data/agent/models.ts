// Single source of truth for the model ids ShareOut calls. First-party Anthropic ids
// and Vercel AI Gateway slugs differ (e.g. Haiku), so each Claude model carries both.

export const OPENAI_CHAT_MODEL = 'gpt-4o';

export const CLAUDE_OPUS = { id: 'claude-opus-5', gateway: 'anthropic/claude-opus-5' } as const;
export const CLAUDE_SONNET = { id: 'claude-sonnet-5', gateway: 'anthropic/claude-sonnet-5' } as const;
export const CLAUDE_HAIKU = { id: 'claude-haiku-4-5-20251001', gateway: 'anthropic/claude-haiku-4.5' } as const;

/** Default Claude model for agents, builds and per-artifact chat. */
export const DEFAULT_CLAUDE_MODEL = CLAUDE_SONNET;
