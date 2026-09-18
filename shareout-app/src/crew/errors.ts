import type { Env } from '../types';
import { createLogger, logError } from '../logging';
import { mapMaterializeFailure, userFacingConnectionToolError } from '../data/connections/errors';
import { userFacingAgentToolError } from '../chat-agent/errors';
export { userFacingReadFileError } from '../chat-agent/errors';
export { userFacingConnectionToolError };

/** Safe tool-result error text for the crew transcript / owner SSE — never leak infra internals. */
export function userFacingCrewToolError(err: unknown, fallback = 'Tool failed.'): string {
  return userFacingAgentToolError(err, fallback);
}

/** Safe web_search tool error — never leak provider HTTP bodies or API keys in the transcript. */
export function userFacingWebSearchToolError(err: unknown): string {
  return userFacingCrewToolError(err, 'Web search failed.');
}

/** Safe pilot_verify tool error — never leak puppeteer/browser protocol internals in the transcript. */
export function userFacingPilotVerifyToolError(err: unknown): string {
  return userFacingCrewToolError(err, 'Pilot verify failed.');
}

/** Safe owner-visible text when a model turn or the run loop fails unexpectedly. */
export function userFacingCrewRunError(_err?: unknown): string {
  return 'The crew run failed. Try again.';
}

/** Safe provider turn error — never echo gateway response bodies or network internals. */
export function userFacingCrewProviderError(_err?: unknown, _httpStatus?: number): string {
  return 'The AI service is temporarily unavailable. Try again.';
}

export function logCrewProviderFailure(
  env: Env,
  fields: { provider: string; model: string; httpStatus?: number },
  err: unknown,
): void {
  logError(
    createLogger(env, {
      scope: 'crew',
      event: 'crew.provider.failed',
      provider: fields.provider,
      model: fields.model,
      http_status: fields.httpStatus,
    }),
    'crew provider turn failed',
    err,
  );
}

/** Safe user-facing text for crew materialize_query failures — mirrors REST materialize API mapping. */
export function userFacingMaterializeToolError(err: unknown): string {
  return mapMaterializeFailure(err).message;
}

export function logCrewToolFailure(
  env: Env,
  fields: { tool: string; ownerId: string; crewId?: string; runId?: string },
  err: unknown,
): void {
  logError(
    createLogger(env, {
      scope: 'crew',
      event: 'crew.tool.failed',
      tool: fields.tool,
      owner_id: fields.ownerId,
      crew_id: fields.crewId,
      run_id: fields.runId,
    }),
    'crew tool failed',
    err,
  );
}

export function logCrewRunFailure(
  env: Env,
  fields: { ownerId: string; crewId: string; runId: string },
  err: unknown,
): void {
  logError(
    createLogger(env, {
      scope: 'crew',
      event: 'crew.run.failed',
      owner_id: fields.ownerId,
      crew_id: fields.crewId,
      run_id: fields.runId,
    }),
    'crew run failed',
    err,
  );
}
