import type { Env, EmailReceivedPayload } from '../types';
import type { EmailSource } from '../scheduling/email';

/** One phase of a delivery, surfaced per-run in the Run Inspector. */
export interface DeliveryStep {
  step: string;                       // fetch | transform | deliver | <free-form>
  status: 'success' | 'failed';
  durationMs?: number;
  detail?: Record<string, unknown>;   // target, rowCount, httpStatus, error, …
}

export interface DeliveryResult {
  success: boolean;
  error?: string;
  /** Optional step trace. Destinations with distinct phases (fetch→deliver)
   *  populate this; the runner synthesizes a single step when absent. */
  steps?: DeliveryStep[];
}

/** Who/what is dispatching a delivery, for auditing and access decisions. */
export interface DeliveryContext {
  artifactId: string;
  /** User the delivery acts on behalf of (job owner_id, sharing user, crew principal). */
  createdBy: string;
  triggeredVia: 'cron' | 'event' | 'manual' | 'crew';
  /** Set when the delivery was fired by an `email.received` event, so destinations
   *  can interpolate the inbound message (sender, subject, tag, body) into templates. */
  eventPayload?: EmailReceivedPayload;
  /** Who sent it, when not a plain job (alert rule, crew). Emails show it in their footer. */
  source?: EmailSource;
}

/**
 * A pluggable delivery target. Slack, email, Discord, webhooks, etc. each
 * implement this so scheduled jobs, the manual share endpoint, and AI Crew all
 * route an artifact through one shared communication layer.
 */
export interface Destination<C = unknown> {
  kind: string;
  /** Returns an error string when the config is invalid, else null. */
  /** What is wrong with `config`, or null. A `{ error, code }` gives callers a stable code to branch on. */
  validate(env: Env, ctx: DeliveryContext, config: C): Promise<string | ConfigProblem | null>;
  deliver(env: Env, ctx: DeliveryContext, config: C): Promise<DeliveryResult>;
}

export interface ConfigProblem { error: string; code: string }

export const problemText = (p: string | ConfigProblem): string => (typeof p === 'string' ? p : p.error);
