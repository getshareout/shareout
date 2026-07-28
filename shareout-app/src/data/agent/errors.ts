import type { Env } from '../../types';
import { createLogger, logError } from '../../logging';

const SAFE_STREAM_ERRORS = new Set([
  'AI API request timed out',
]);

const SAFE_EDIT_ERRORS = new Set([
  'Search text not found',
  'Invalid edit type',
  'No versions found',
]);

/** Safe client text for AI stream error chunks — never leak upstream API bodies or infra errors. */
export function userFacingAgentStreamError(upstreamError?: string): string {
  if (upstreamError && SAFE_STREAM_ERRORS.has(upstreamError)) {
    return upstreamError;
  }
  if (upstreamError?.startsWith('AI API error:')) {
    const statusMatch = upstreamError.match(/^AI API error: (\d+)/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      if (status === 429) return 'AI service is busy. Try again shortly.';
      if (status === 408 || status === 504) return 'AI request timed out';
    }
    return 'AI request failed';
  }
  if (upstreamError === 'No response body') {
    return 'AI request failed';
  }
  if (upstreamError?.includes('AI provider not configured')) {
    return 'AI provider not configured';
  }
  return 'Chat failed';
}

/** Safe client text for unexpected chat handler failures. */
export function userFacingAgentChatFailure(_err: unknown): string {
  return 'Chat failed';
}

/** Safe client text for non-streaming AI completion failures (slides AI, deck generate). */
export function userFacingAgentCompletionError(err: unknown): string {
  const upstream = err instanceof Error ? err.message : undefined;
  const mapped = userFacingAgentStreamError(upstream);
  return mapped === 'Chat failed' ? 'Generation failed' : mapped;
}

/** Safe client text for internal admin analyst ask failures. */
export function userFacingAnalystFailure(err: unknown): string {
  const upstream = err instanceof Error ? err.message : undefined;
  const mapped = userFacingAgentStreamError(upstream);
  return mapped === 'Chat failed' ? 'Analyst request failed' : mapped;
}

export function logSlidesAiFailure(
  env: Env,
  message: string,
  err: unknown,
  fields: {
    artifactId: string;
    route: 'slide-ai' | 'generate';
    action?: string;
  },
): void {
  logError(
    createLogger(env, {
      scope: 'slides',
      event: 'slides.ai.failed',
      artifact_id: fields.artifactId,
      route: fields.route,
      action: fields.action,
    }),
    message,
    err,
  );
}

export function logInternalAdminFailure(
  env: Env,
  message: string,
  err: unknown,
  fields: { route: string },
): void {
  logError(
    createLogger(env, {
      scope: 'internal-admin',
      event: 'internal_admin.failed',
      route: fields.route,
    }),
    message,
    err,
  );
}

/** Safe client text when admin context assembly fails. */
export function userFacingAdminContextFailure(_err: unknown): string {
  return 'Failed to build context';
}

/** Safe per-file apply-edit failure — preserve validation messages only. */
export function userFacingApplyEditError(err: unknown): string {
  if (err instanceof Error && SAFE_EDIT_ERRORS.has(err.message)) {
    return err.message;
  }
  return 'Failed to apply edit';
}

export function logAgentChatFailure(
  env: Env,
  message: string,
  err: unknown,
  fields: {
    artifactId: string;
    mode: 'visitor' | 'admin';
    conversationId?: string;
    upstreamError?: string;
  },
): void {
  logError(
    createLogger(env, {
      scope: 'agent',
      event: 'agent.chat.failed',
      artifact_id: fields.artifactId,
      mode: fields.mode,
      conversation_id: fields.conversationId,
      upstream_error: fields.upstreamError,
    }),
    message,
    err,
  );
}

/** Safe client text for pilot upstream HTTP failures — never leak API keys or provider bodies. */
export function userFacingPilotUpstreamError(upstreamStatus: number): string {
  if (upstreamStatus === 429) return 'AI service is busy. Try again shortly.';
  if (upstreamStatus === 408 || upstreamStatus === 504) return 'AI request timed out';
  return 'AI request failed';
}

/** OpenAI-compatible error body for pilot proxy failures (page-agent parses `error.message`). */
export function pilotUpstreamErrorBody(upstreamStatus: number): Record<string, unknown> {
  return {
    error: {
      message: userFacingPilotUpstreamError(upstreamStatus),
      type: 'upstream_error',
      code: 'UPSTREAM_ERROR',
    },
  };
}

export function logPilotUpstreamFailure(
  env: Env,
  fields: {
    artifactId: string;
    mode: 'pilot' | 'pilot_spike';
    upstreamStatus: number;
    upstreamBody: string;
    taskId?: string;
  },
): void {
  logError(
    createLogger(env, {
      scope: 'agent',
      event: 'agent.pilot.upstream_failed',
      artifact_id: fields.artifactId,
      mode: fields.mode,
      task_id: fields.taskId,
      upstream_status: fields.upstreamStatus,
      upstream_body: fields.upstreamBody.slice(0, 2000),
    }),
    'Pilot upstream request failed',
    new Error(`upstream ${fields.upstreamStatus}`),
  );
}
