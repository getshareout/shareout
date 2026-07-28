/**
 * AI provider configuration for the visual editor chat.
 *
 * Resolution order: Vercel AI Gateway → Anthropic → OpenAI.
 * Set `DEBUG = true` locally to trace prompts, SSE events, and parsed patches.
 */

import type { Env } from '../../types';

export const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
export const OPENAI_MODEL = 'gpt-4o';
export const VERCEL_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';
export const EDITOR_MAX_TOKENS = 8192;

/** EDIT-10 F2: off in prod (was logging full prompts/patches/HTML previews). */
export const DEBUG = false;

export function debugLog(category: string, message: string, data?: unknown): void {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ` ${JSON.stringify(data, null, 0)}` : '';
  console.log(`[EditorChat ${timestamp}] [${category}] ${message}${dataStr}`);
}

export function debugError(category: string, message: string, error?: unknown): void {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  console.error(`[EditorChat ${timestamp}] [${category}] ERROR: ${message}`, error);
}

export type AIProvider = 'anthropic' | 'openai' | 'vercel-gateway';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Pick the first configured upstream model API for editor chat. */
export function getAIProvider(env: Env): AIConfig | null {
  if (env.VERCEL_AI_GATEWAY) {
    debugLog('CONFIG', 'Using Vercel AI Gateway', { keyPrefix: env.VERCEL_AI_GATEWAY.slice(0, 8) });
    return {
      provider: 'vercel-gateway',
      apiKey: env.VERCEL_AI_GATEWAY,
      baseUrl: VERCEL_GATEWAY_URL,
      model: `openai/${OPENAI_MODEL}`,
    };
  }

  if (env.ANTHROPIC_API_KEY) {
    debugLog('CONFIG', 'Using Anthropic API directly');
    return {
      provider: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: 'https://api.anthropic.com/v1',
      model: ANTHROPIC_MODEL,
    };
  }

  if (env.OPENAI_API_KEY) {
    debugLog('CONFIG', 'Using OpenAI API directly');
    return {
      provider: 'openai',
      apiKey: env.OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com/v1',
      model: OPENAI_MODEL,
    };
  }

  debugError('CONFIG', 'No AI provider configured - need VERCEL_AI_GATEWAY, ANTHROPIC_API_KEY, or OPENAI_API_KEY');
  return null;
}
