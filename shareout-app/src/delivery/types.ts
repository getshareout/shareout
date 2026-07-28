import type { Env, EmailReceivedPayload } from '../types';

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
}

/**
 * A pluggable delivery target. Slack, email, Discord, webhooks, etc. each
 * implement this so scheduled jobs, the manual share endpoint, and AI Crew all
 * route an artifact through one shared communication layer.
 */
export interface Destination<C = unknown> {
  kind: string;
  /** Returns an error string when the config is invalid, else null. */
  validate(env: Env, ctx: DeliveryContext, config: C): Promise<string | null>;
  deliver(env: Env, ctx: DeliveryContext, config: C): Promise<DeliveryResult>;
}
