import type { Env } from '../../types';
import type { ChatChunk, MessageRole } from './types';
import { fetchWithTimeout, FetchTimeoutError } from '../../fetch-utils';
import { fireAlert } from '../../observability/alerts';

const AI_TIMEOUT_MS = 30000;
const AI_STREAM_TIMEOUT_MS = 60000;
export const AGENT_CHAT_MODEL = 'gpt-4o';
const OPENAI_MODEL = AGENT_CHAT_MODEL;
const VERCEL_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';

/** Default model for the create-page build agent — a stronger model produces far better design output. */
const DEFAULT_BUILD_MODEL = 'anthropic/claude-sonnet-4.6';

export type AIProvider = 'openai' | 'vercel-gateway';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Build an AIConfig for a caller-supplied (bring-your-own) provider key. */
export function buildAIConfig(provider: AIProvider, apiKey: string): AIConfig {
  if (provider === 'vercel-gateway') {
    return { provider, apiKey, baseUrl: VERCEL_GATEWAY_URL, model: `openai/${OPENAI_MODEL}` };
  }
  return { provider: 'openai', apiKey, baseUrl: 'https://api.openai.com/v1', model: OPENAI_MODEL };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface OpenAIStreamEvent {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/**
 * Ordered failover candidates from the configured env keys — gateway first (same order
 * as editor chat, without Anthropic), then OpenAI. When the preferred provider fails with
 * a provider-level error, callers retry against the next entry (see resolveFailoverChain).
 */
export function getAIProviderChain(env: Env): AIConfig[] {
  const chain: AIConfig[] = [];
  if (env.VERCEL_AI_GATEWAY) {
    chain.push({
      provider: 'vercel-gateway',
      apiKey: env.VERCEL_AI_GATEWAY,
      baseUrl: VERCEL_GATEWAY_URL,
      model: `openai/${OPENAI_MODEL}`,
    });
  }
  if (env.OPENAI_API_KEY) {
    chain.push({
      provider: 'openai',
      apiKey: env.OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com/v1',
      model: OPENAI_MODEL,
    });
  }
  return chain;
}

/** Preferred provider (first in the failover chain), or null when none configured. */
export function getAIProvider(env: Env): AIConfig | null {
  return getAIProviderChain(env)[0] ?? null;
}

const AI_PROVIDER_ALERT_COOLDOWN_SEC = 6 * 60 * 60;

/** Provider-level failures worth failing over from (credits/auth/rate-limit/outage). */
export function isProviderLevelStatus(status: number): boolean {
  return status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;
}

/**
 * Providers to attempt for one env-backed request. A caller-supplied override runs first;
 * failover to the rest of the env chain is allowed only when that override is itself an
 * env provider (matched by key) — a bring-your-own key never spends another provider.
 */
export function resolveFailoverChain(env: Env, configOverride?: AIConfig | null): AIConfig[] {
  const chain = getAIProviderChain(env);
  if (!configOverride) return chain;
  const idx = chain.findIndex(
    c => c.provider === configOverride.provider && c.apiKey === configOverride.apiKey
  );
  return idx >= 0 ? [configOverride, ...chain.slice(idx + 1)] : [configOverride];
}

/** True when cfg is one of OUR env-configured providers (vs a customer BYO key). */
export function isEnvProvider(env: Env, cfg: AIConfig): boolean {
  return getAIProviderChain(env).some(c => c.provider === cfg.provider && c.apiKey === cfg.apiKey);
}

/** Deduped super-admin alert fired when a provider fails (once per 6h per provider).
 *  Callers must gate on isEnvProvider: a customer's failing BYO key is not our outage,
 *  and letting it fire would also burn the shared dedup key and mask a real one. */
export function alertProviderFailure(env: Env, cfg: AIConfig, error: string, failedOver: boolean): void {
  const detail = error.length > 300 ? error.slice(0, 300) + '…' : error;
  const text = failedOver
    ? `⚠️ AI provider ${cfg.provider} (${cfg.model}) failed — ${detail}\nTraffic failed over to the next provider. Check its credits/key.`
    : `🚨 AI provider ${cfg.provider} (${cfg.model}) failed — ${detail}\nNo fallback left; AI requests are failing now. Fix the provider.`;
  fireAlert(env, `ai:provider:failed:${cfg.provider}`, text, AI_PROVIDER_ALERT_COOLDOWN_SEC).catch(() => {});
}

/** Model id stored in conversation metadata (always OpenAI, matches editor). */
export function getAgentChatModel(env: Env): string {
  return getAIProvider(env)?.model.replace(/^openai\//, '') ?? AGENT_CHAT_MODEL;
}

/**
 * Build-agent provider config — routes the create-page builder to a stronger model
 * (Claude Sonnet via the Vercel AI Gateway) while leaving planner/visitor/admin chat
 * on the default provider. Requires the gateway key; falls back to the default provider.
 */
export function getBuildConfig(env: Env): AIConfig | null {
  if (env.VERCEL_AI_GATEWAY) {
    return {
      provider: 'vercel-gateway',
      apiKey: env.VERCEL_AI_GATEWAY,
      baseUrl: VERCEL_GATEWAY_URL,
      model: env.BUILD_MODEL || DEFAULT_BUILD_MODEL,
    };
  }
  return getAIProvider(env);
}

function filterMessages(messages: Array<{ role: MessageRole; content: string }>): ChatMessage[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
}

/**
 * Run a chat over the streaming API but return the full accumulated text once complete.
 * Streaming responds at first byte, so the request timeout only has to cover time-to-first-byte
 * — not the whole generation. This lets slow, large generations (e.g. a full HTML page on a
 * strong model) finish without tripping the non-streaming read timeout.
 */
export async function chatComplete(
  env: Env,
  messages: Array<{ role: MessageRole; content: string }>,
  systemPrompt: string,
  maxTokens: number,
  configOverride?: AIConfig | null
): Promise<string> {
  let out = '';
  for await (const chunk of streamChat(env, messages, systemPrompt, '', maxTokens, configOverride)) {
    if (chunk.type === 'content' && chunk.content) out += chunk.content;
    else if (chunk.type === 'error') throw new Error(chunk.error || 'AI stream error');
  }
  return out;
}

export async function* streamChat(
  env: Env,
  messages: Array<{ role: MessageRole; content: string }>,
  systemPrompt: string,
  _model: string,
  maxTokens: number = 4096,
  configOverride?: AIConfig | null
): AsyncGenerator<ChatChunk> {
  const attempts = resolveFailoverChain(env, configOverride);
  if (attempts.length === 0) {
    yield {
      type: 'error',
      error: 'AI provider not configured (need VERCEL_AI_GATEWAY or OPENAI_API_KEY)',
    };
    return;
  }

  const chatMessages = filterMessages(messages);

  for (let i = 0; i < attempts.length; i++) {
    const cfg = attempts[i];
    const isLast = i === attempts.length - 1;
    let emitted = false;
    let failure: { error: string; retryable: boolean } | null = null;

    try {
      const response = await fetchWithTimeout(
        `${cfg.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: systemPrompt },
              ...chatMessages,
            ],
            stream: true,
            stream_options: { include_usage: true },
          }),
        },
        AI_STREAM_TIMEOUT_MS
      );

      if (!response.ok) {
        const error = await response.text();
        failure = {
          error: `AI API error: ${response.status} ${error}`,
          retryable: isProviderLevelStatus(response.status),
        };
      } else {
        const reader = response.body?.getReader();
        if (!reader) {
          failure = { error: 'No response body', retryable: true };
        } else {
          const decoder = new TextDecoder();
          let buffer = '';
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

                try {
                  const event = JSON.parse(data) as OpenAIStreamEvent;

                  const content = event.choices?.[0]?.delta?.content;
                  if (content) {
                    emitted = true;
                    yield { type: 'content', content };
                  }

                  if (event.usage) {
                    inputTokens = event.usage.prompt_tokens;
                    outputTokens = event.usage.completion_tokens;
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          } finally {
            reader.releaseLock();
          }

          yield { type: 'done', usage: { input_tokens: inputTokens, output_tokens: outputTokens } };
          return;
        }
      }
    } catch (err) {
      // Timeout / network error: provider-level, retry the next provider (nothing streamed).
      failure = {
        error: err instanceof FetchTimeoutError
          ? 'AI API request timed out'
          : (err instanceof Error ? err.message : 'AI network error'),
        retryable: true,
      };
    }

    // Fail over only when the failure is provider-level AND nothing has streamed yet
    // (streamed output can't be un-emitted, so a retry would duplicate content).
    const canFailover = failure.retryable && !emitted && !isLast;
    if (failure.retryable && !emitted && isEnvProvider(env, cfg)) {
      alertProviderFailure(env, cfg, failure.error, canFailover);
    }
    if (canFailover) continue;
    yield { type: 'error', error: failure.error };
    return;
  }
}

export async function chat(
  env: Env,
  messages: Array<{ role: MessageRole; content: string }>,
  systemPrompt: string,
  _model: string,
  maxTokens: number = 4096,
  configOverride?: AIConfig | null,
  timeoutMs: number = AI_TIMEOUT_MS
): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number } }> {
  const aiConfig = configOverride ?? getAIProvider(env);
  if (!aiConfig) {
    throw new Error('AI provider not configured (need VERCEL_AI_GATEWAY or OPENAI_API_KEY)');
  }

  const { apiKey, baseUrl, model } = aiConfig;
  const chatMessages = filterMessages(messages);

  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatMessages,
        ],
      }),
    },
    timeoutMs
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI API error: ${response.status} ${error}`);
  }

  const result = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: result.choices[0]?.message?.content || '',
    usage: {
      input_tokens: result.usage.prompt_tokens,
      output_tokens: result.usage.completion_tokens,
    },
  };
}
