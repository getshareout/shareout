/**
 * Core job execution — routes actions through the delivery registry.
 */
import type { Env, EmailReceivedPayload } from '../../types';
import { getUserRole } from '../../artifacts';
import { getDestination, type DeliveryContext } from '../../delivery/registry';
import type { DeliveryStep } from '../../delivery/types';
import { isArtifactFeatureEnabled } from '../../features/flags';
import { generateId } from '../../crypto-utils';
import { DEST_FEATURE } from './constants';
import type { JobAction, JobConfig } from './types';

export type JobActionResult = {
  success: boolean;
  error?: string;
  disable?: boolean;
  steps?: DeliveryStep[];
};

/**
 * Execute one job action via the shared delivery registry.
 * Re-checks creator access on every run; returns `disable: true` when access is gone.
 */
export async function executeJobAction(
  env: Env,
  action: JobAction,
  artifactId: string,
  ownerId: string,
  config: JobConfig,
  triggeredVia: DeliveryContext['triggeredVia'] = 'cron',
  eventPayload?: EmailReceivedPayload,
): Promise<JobActionResult> {
  const role = await getUserRole(env, artifactId, ownerId);
  if (!role) {
    return {
      success: false,
      error: 'Access revoked: job creator can no longer access this artifact',
      disable: true,
    };
  }

  const schedFeature = triggeredVia === 'event' ? 'automation.event_triggers' : 'automation.scheduled_jobs';
  if (!(await isArtifactFeatureEnabled(env, schedFeature, artifactId))) {
    return { success: false, error: 'Scheduling is disabled for this workspace' };
  }
  const destFeature = DEST_FEATURE[action];
  if (destFeature && !(await isArtifactFeatureEnabled(env, destFeature, artifactId))) {
    return { success: false, error: `Delivery to ${action} is disabled for this workspace` };
  }

  const destination = getDestination(action);
  if (!destination) {
    return { success: false, error: `Unknown action: ${action}` };
  }

  return destination.deliver(
    env,
    { artifactId, createdBy: ownerId, triggeredVia, eventPayload },
    config,
  );
}

/** Persist per-run delivery steps; synthesizes a coarse step when the destination omits detail. */
export async function recordJobSteps(
  env: Env,
  logId: string,
  jobId: string,
  result: JobActionResult,
): Promise<void> {
  if (typeof env.DB.batch !== 'function') return;

  const steps: DeliveryStep[] = result.steps?.length
    ? result.steps
    : [{
        step: 'deliver',
        status: result.success ? 'success' : 'failed',
        detail: result.error ? { error: result.error } : undefined,
      }];

  const stmt = env.DB.prepare(
    `INSERT INTO job_run_steps (id, run_id, job_id, seq, step, status, duration_ms, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await env.DB.batch(
    steps.map((s, i) => stmt.bind(
      generateId('jrs'), logId, jobId, i, s.step, s.status,
      s.durationMs ?? null, s.detail ? JSON.stringify(s.detail) : null,
    )),
  );
}
