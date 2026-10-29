/**
 * Durable page builds: what a build job is, what it ends as, and the limits it runs under.
 * Shared by the BuildJobs Durable Object (do.ts), the runners (runners.ts) and the routes (client.ts).
 */
import type { Locale } from '../i18n';
import type { PendingAction } from '../chat-agent/actions';
import type { GenerateRequest } from '../router/api/create';

/** queued → running → published | failed | cancelled. */
export type BuildJobStatus = 'queued' | 'running' | 'published' | 'failed' | 'cancelled';

/** /v1/create/generate's build phase, exactly as the route would have streamed it inline. */
export type CreateBuildSpec = { kind: 'create' } & GenerateRequest;

/** The assistant's confirmed build_artifact action; the result is appended to the thread it came from. */
export interface AssistantBuildSpec {
  kind: 'assistant';
  scopeKey: string;
  userId: string;
  threadId: string | null;
  action: Extract<PendingAction, { kind: 'build_artifact' }>;
  locale: Locale;
}

export type BuildJobSpec = CreateBuildSpec | AssistantBuildSpec;

/** How a build ended, as the job records it and the notification tells it. */
export interface BuildJobOutcome {
  ok: boolean;
  /** The page's name: the assistant's, else derived from the prompt. */
  name: string;
  url?: string;
  slug?: string;
  artifactId?: string;
  /** Why it failed, already in the user's language. */
  error?: string;
  /** A failure of the job itself rather than of the build. */
  reason?: 'interrupted' | 'timeout' | 'cancelled';
}

/** One event on the wire (the same SSE shapes the clients read today). */
export type BuildEvent = { type: string } & Record<string, unknown>;
export type Emit = (ev: BuildEvent) => void;

/** What GET /v1/builds/:id answers. */
export interface BuildJobView {
  id: string;
  kind: BuildJobSpec['kind'];
  status: BuildJobStatus;
  name: string;
  /** Progress lines so far, oldest first (the last few). */
  steps: string[];
  outcome: BuildJobOutcome | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

/** Builds one user may have queued or running at once. A second, different build is refused. */
export const MAX_ACTIVE_BUILDS = 1;
/** A job still running after this is failed. The agent's own budget is 8 min; an alarm may run 15. */
export const JOB_TIMEOUT_MS = 12 * 60_000;
/** Ended jobs kept per user (for reattach and the status endpoint). */
export const KEEP_JOBS = 20;
/** Replayable events kept per job (progress steps and the final result; token deltas are not kept). */
export const KEEP_EVENTS = 60;
/** A keep-alive on every open stream: a long silent model turn is not cut by an idle proxy, and a closed tab is noticed. */
export const PING_MS = 20_000;
/** How long the end of a job waits for its last events to reach (or fail to reach) the attached clients. */
export const LANDING_MS = 500;
/** Unread events after which an attached client counts as gone (token deltas come fast; a reader keeps up). */
export const MAX_BACKLOG = 500;

export const isActive = (s: BuildJobStatus): boolean => s === 'queued' || s === 'running';
