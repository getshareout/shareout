/**
 * One honest answer to "what is this instance actually configured for?"
 *
 * A self-hoster's config is spread across wrangler vars, Worker secrets, and
 * bindings, and the only way to learn that (say) AI is dead was to use an AI feature
 * and watch it do nothing. This assembles the whole picture in one document, and —
 * more usefully — names what is unset **and what that disables**, so an operator or
 * the agent configuring for them has something to act on.
 *
 * Secrets are never included, only whether each is present.
 */
import type { Env } from '../types';
import { getPlatformOrigin } from '../config/origins';
import { googleOAuthConfigured } from '../config/auth-providers';
import { schemaReady } from '../pages/setup';
import { getAIProviderChain } from '../data/agent/anthropic';
import { storageQuotaBytes, storageMaxFileBytes } from '../storage-quota';
import { envAdminEmails } from './recipients';
import { badgeEnabled } from '../serve/badge';

/** Something unset, and the capability it costs. */
export interface ConfigGap {
  setting: string;
  disables: string;
  /** Exact command or var to fix it. */
  fix: string;
}

export interface InstanceConfig {
  origin: string;
  schema: 'ready' | 'missing';
  auth: {
    password: true;
    google: boolean;
    email_otp_delivery: 'email' | 'worker_log';
  };
  ai: {
    /** Provider names in failover order. Empty ⇒ every AI feature is inert. */
    providers: string[];
    /** Whether workspaces can save their own key (needs CREDENTIALS_KEY). */
    byo_keys: boolean;
  };
  email: {
    binding: boolean;
    default_from: string | null;
    inbox_domain: string | null;
  };
  storage: {
    quota_bytes: number;
    max_file_bytes: number;
    daily_bandwidth_bytes_per_owner: number;
  };
  sharing: {
    open_visibility: boolean;
    signups_paused: boolean;
    artifact_badge: boolean;
    artifact_origin: string | null;
  };
  bindings: {
    durable_objects: boolean;
    workers_ai: boolean;
    vectorize: boolean;
    browser: boolean;
    views_queue: boolean;
    rate_limit_kv: boolean;
  };
  admins: {
    /** Emails naming an instance admin exist. The addresses themselves are not listed. */
    configured: boolean;
    setup_admin_email: boolean;
  };
  gaps: ConfigGap[];
}

function envNumber(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function truthy(value: string | undefined): boolean {
  const v = (value || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export async function buildInstanceConfig(env: Env): Promise<InstanceConfig> {
  const providers = getAIProviderChain(env).map((c) => c.provider);
  const hasSchema = await schemaReady(env);
  const adminsConfigured = envAdminEmails(env).length > 0;
  const gaps: ConfigGap[] = [];

  if (!hasSchema) {
    gaps.push({
      setting: 'D1 schema',
      disables: 'everything — no tables exist',
      fix: 'npx wrangler d1 migrations apply DB --remote',
    });
  }
  if (!env.SHAREOUT_BASE_URL?.trim()) {
    gaps.push({
      setting: 'SHAREOUT_BASE_URL',
      disables: 'correct agent-facing URLs — the skill and API docs name the hosted instance instead',
      fix: 'set it in wrangler.toml [vars] to this Worker\'s own origin, then redeploy',
    });
  }
  if (providers.length === 0) {
    gaps.push({
      setting: 'VERCEL_AI_GATEWAY or OPENAI_API_KEY',
      disables: 'Crew AI, the home assistant, in-artifact chat, editor AI, knowledge distillation, auto-summaries',
      fix: 'npx wrangler secret put OPENAI_API_KEY (or VERCEL_AI_GATEWAY)',
    });
  }
  if (!env.CREDENTIALS_KEY) {
    gaps.push({
      setting: 'CREDENTIALS_KEY',
      disables: 'per-workspace AI keys and stored connector credentials',
      fix: 'openssl rand -hex 32 | npx wrangler secret put CREDENTIALS_KEY',
    });
  }
  if (!env.EMAIL) {
    gaps.push({
      setting: 'EMAIL binding',
      disables: 'sent mail — one-time codes, invites and digests reach the Worker log instead. Password sign-in is unaffected',
      fix: 'add a Cloudflare Email binding named EMAIL, plus EMAIL_DEFAULT_FROM',
    });
  }
  if (!adminsConfigured && !env.SETUP_ADMIN_EMAIL?.trim()) {
    gaps.push({
      setting: 'INSTANCE_ADMIN_EMAILS',
      disables: 'a stable owner — while nothing names one, the earliest user is treated as instance admin',
      fix: 'set INSTANCE_ADMIN_EMAILS in wrangler.toml [vars]',
    });
  }

  return {
    origin: getPlatformOrigin(env),
    schema: hasSchema ? 'ready' : 'missing',
    auth: {
      password: true,
      google: googleOAuthConfigured(env),
      email_otp_delivery: env.EMAIL ? 'email' : 'worker_log',
    },
    ai: { providers, byo_keys: Boolean(env.CREDENTIALS_KEY) },
    email: {
      binding: Boolean(env.EMAIL),
      default_from: env.EMAIL_DEFAULT_FROM ?? null,
      inbox_domain: env.EMAIL_INBOX_DOMAIN ?? null,
    },
    storage: {
      quota_bytes: storageQuotaBytes(env),
      max_file_bytes: storageMaxFileBytes(env),
      daily_bandwidth_bytes_per_owner: envNumber(env.DAILY_BANDWIDTH_BYTES_PER_OWNER),
    },
    sharing: {
      open_visibility: !truthy(env.OPEN_VISIBILITY_DISABLED),
      signups_paused: truthy(env.SIGNUPS_PAUSED),
      artifact_badge: badgeEnabled(env),
      artifact_origin: env.ARTIFACT_ORIGIN ?? null,
    },
    bindings: {
      durable_objects: Boolean(env.MINIDB),
      workers_ai: Boolean(env.AI),
      vectorize: Boolean(env.VECTORIZE),
      browser: Boolean(env.BROWSER),
      views_queue: Boolean(env.VIEWS_QUEUE),
      rate_limit_kv: Boolean(env.RATE_LIMIT_KV),
    },
    admins: {
      configured: adminsConfigured,
      setup_admin_email: Boolean(env.SETUP_ADMIN_EMAIL?.trim()),
    },
    gaps,
  };
}
