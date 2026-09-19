import type { Env } from '../../types';
import type { ChatChunk, MessageRole } from './types';
import { fetchWithTimeout, FetchTimeoutError } from '../../fetch-utils';
import { createLogger } from '../../logging';
import { DEFAULT_CLAUDE_MODEL, OPENAI_CHAT_MODEL } from './models';

const AI_TIMEOUT_MS = 30000;
const AI_STREAM_TIMEOUT_MS = 60000;
export const AGENT_CHAT_MODEL = OPENAI_CHAT_MODEL;
const OPENAI_MODEL = AGENT_CHAT_MODEL;
const VERCEL_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
export const ANTHROPIC_VERSION = '2023-06-01';

export type AIProvider = 'openai' | 'vercel-gateway' | 'anthropic';

export const DEFAULT_PROVIDER_ORDER: readonly AIProvider[] = ['vercel-gateway', 'anthropic', 'openai'];

export const NO_PROVIDER_ERROR =
  'AI provider not configured (set VERCEL_AI_GATEWAY, ANTHROPIC_API_KEY or OPENAI_API_KEY)';

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
  if (provider === 'anthropic') {
    return { provider, apiKey, baseUrl: ANTHROPIC_BASE_URL, model: DEFAULT_CLAUDE_MODEL.id };
  }
  return { provider: 'openai', apiKey, baseUrl: 'https://api.openai.com/v1', model: OPENAI_MODEL };
}

/** Headers for a provider request — Anthropic's native API authenticates with x-api-key. */
export function providerHeaders(cfg: AIConfig): Record<string, string> {
  return cfg.provider === 'anthropic'
    ? { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': ANTHROPIC_VERSION }
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
}

/** Configured providers in failover order: AI_PROVIDER_ORDER first, then the rest by default order. */
export function providerOrder(env: Env): AIProvider[] {
  const listed = (env.AI_PROVIDER_ORDER || '')
    .split(',')
    .map(p => p.trim())
    .filter((p): p is AIProvider => (DEFAULT_PROVIDER_ORDER as readonly string[]).includes(p));
  return [...new Set([...listed, ...DEFAULT_PROVIDER_ORDER])];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface StreamEvent {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
  type?: string;
  message?: { usage?: { input_tokens?: number } };
  delta?: { type?: string; text?: string };
  error?: { message?: string };
}

/** Request URL + body for one completion call in the provider's wire format. */
function completionRequest(
  cfg: AIConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  maxTokens: number,
  stream: boolean
): { url: string; body: Record<string, unknown> } {
  if (cfg.provider === 'anthropic') {
    return {
      url: `${cfg.baseUrl}/messages`,
      body: {
        model: cfg.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
        thinking: { type: 'disabled' },
        ...(stream ? { stream: true } : {}),
      },
    };
  }
  return {
    url: `${cfg.baseUrl}/chat/completions`,
    body: {
      model: cfg.model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    },
  };
}

/**
 * Ordered failover candidates from the configured env keys (see providerOrder). When the
 * preferred provider fails with a provider-level error, callers retry against the next
 * entry (see resolveFailoverChain).
 */
export function getAIProviderChain(env: Env): AIConfig[] {
  const keys: Record<AIProvider, string | undefined> = {
    'vercel-gateway': env.VERCEL_AI_GATEWAY,
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
  };
  return providerOrder(env).flatMap(p => (keys[p] ? [buildAIConfig(p, keys[p]!)] : []));
}

/** Preferred provider (first in the failover chain), or null when none configured. */
export function getAIProvider(env: Env): AIConfig | null {
  return getAIProviderChain(env)[0] ?? null;
}

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

/** Log a provider failure for the `/admin` health view.
 *  Callers must gate on isEnvProvider: a customer's failing BYO key is not our outage. */
export function alertProviderFailure(env: Env, cfg: AIConfig, error: string, failedOver: boolean): void {
  const detail = error.length > 300 ? error.slice(0, 300) + '…' : error;
  createLogger(env, { scope: 'ai' })[failedOver ? 'warn' : 'error']('AI provider failed', {
    provider: cfg.provider,
    model: cfg.model,
    failed_over: failedOver,
    error: detail,
  });
}

/** Model id stored in conversation metadata (provider prefix stripped). */
export function getAgentChatModel(env: Env): string {
  return getAIProvider(env)?.model.replace(/^openai\//, '') ?? AGENT_CHAT_MODEL;
}

/** Stronger-model variant of a provider config, for the build agent and the chat agent. */
function withBuildModel(env: Env, cfg: AIConfig): AIConfig {
  if (cfg.provider === 'vercel-gateway') {
    return { ...cfg, model: env.BUILD_MODEL || DEFAULT_CLAUDE_MODEL.gateway };
  }
  if (cfg.provider === 'anthropic') {
    const own = env.BUILD_MODEL && !env.BUILD_MODEL.includes('/') ? env.BUILD_MODEL : '';
    return { ...cfg, model: own || DEFAULT_CLAUDE_MODEL.id };
  }
  return cfg;
}

/** Build-model failover chain — same provider order as getAIProviderChain. */
export function getBuildChain(env: Env): AIConfig[] {
  return getAIProviderChain(env).map(cfg => withBuildModel(env, cfg));
}

/**
 * Build-agent provider config — routes the create-page builder to a stronger model
 * (Claude via the Vercel AI Gateway or the Anthropic API) while leaving planner/visitor/admin
 * chat on the default model. OpenAI-only instances keep the default model.
 */
export function getBuildConfig(env: Env): AIConfig | null {
  return getBuildChain(env)[0] ?? null;
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
    yield { type: 'error', error: NO_PROVIDER_ERROR };
    return;
  }

  const chatMessages = filterMessages(messages);

  for (let i = 0; i < attempts.length; i++) {
    const cfg = attempts[i];
    const isLast = i === attempts.length - 1;
    let emitted = false;
    let failure: { error: string; retryable: boolean } | null = null;

    try {
      const req = completionRequest(cfg, systemPrompt, chatMessages, maxTokens, true);
      const response = await fetchWithTimeout(
        req.url,
        { method: 'POST', headers: providerHeaders(cfg), body: JSON.stringify(req.body) },
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

                let event: StreamEvent;
                try {
                  event = JSON.parse(data) as StreamEvent;
                } catch {
                  continue;
                }

                if (event.type === 'error') {
                  failure = { error: `AI API error: ${event.error?.message ?? 'stream error'}`, retryable: true };
                  break;
                }

                const content = event.choices?.[0]?.delta?.content
                  ?? (event.delta?.type === 'text_delta' ? event.delta.text : undefined);
                if (content) {
                  emitted = true;
                  yield { type: 'content', content };
                }

                if (event.message?.usage?.input_tokens !== undefined) inputTokens = event.message.usage.input_tokens;
                if (event.usage) {
                  inputTokens = event.usage.prompt_tokens ?? inputTokens;
                  outputTokens = event.usage.completion_tokens ?? event.usage.output_tokens ?? outputTokens;
                }
              }
              if (failure) break;
            }
          } finally {
            reader.releaseLock();
          }

          if (!failure) {
            yield { type: 'done', usage: { input_tokens: inputTokens, output_tokens: outputTokens } };
            return;
          }
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
    throw new Error(NO_PROVIDER_ERROR);
  }

  const req = completionRequest(aiConfig, systemPrompt, filterMessages(messages), maxTokens, false);
  const response = await fetchWithTimeout(
    req.url,
    { method: 'POST', headers: providerHeaders(aiConfig), body: JSON.stringify(req.body) },
    timeoutMs
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI API error: ${response.status} ${error}`);
  }

  if (aiConfig.provider === 'anthropic') {
    const result = await response.json() as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    return {
      content: result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join(''),
      usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
    };
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
