import type { Env } from '../types';
import { createLogger, logError } from '../logging';

function isSafeScenarioError(message: string): boolean {
  if (message.startsWith('unknown scenario:')) return true;
  if (message.startsWith('artifact "') && message.includes(' not found')) return true;
  return false;
}

/** Safe client text for demo scenario build failures — never leak D1/infrastructure errors. */
export function userFacingScenarioError(err: unknown): string {
  if (err instanceof Error && isSafeScenarioError(err.message)) {
    return err.message;
  }
  return 'Scenario build failed';
}

export function mapScenarioFailure(err: unknown): { message: string; code: string; status: number } {
  const message = userFacingScenarioError(err);
  if (message === 'Scenario build failed') {
    return { message, code: 'SCENARIO_ERROR', status: 500 };
  }
  return { message, code: 'SCENARIO_ERROR', status: 400 };
}

export function logScenarioFailure(
  env: Env,
  err: unknown,
  fields: { workspace: string; scenario: string },
): void {
  logError(
    createLogger(env, {
      scope: 'demo',
      event: 'demo.scenario.failed',
      workspace: fields.workspace,
      scenario: fields.scenario,
    }),
    'demo scenario build failed',
    err,
  );
}
