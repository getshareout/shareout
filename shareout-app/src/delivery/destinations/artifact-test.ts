import type { Destination } from '../types';
import type { ArtifactTestJobConfig } from '../../scheduling/jobs';
import { getTestConfig } from '../../tests/config';
import { runTests } from '../../tests/runner';

// Scheduled Artifact Tests (Phase 2 Unit A). Runs the artifact's configured tests
// against its current LIVE (production) version on the hourly cron — a heartbeat
// that catches data/contract drift that only happens between publishes. No config
// to author: the job runs whatever tests the artifact already has enabled.
//
// A non-passing run surfaces as a job failure (job_runs + last_status) so the owner
// sees it on the schedule; runTests() has already pushed the Telegram alert. Jobs of
// this kind are throttled per cron tick by runScheduledJobs (browser-session cap).
export const artifactTestDestination: Destination<ArtifactTestJobConfig> = {
  kind: 'artifact_test',

  async validate(_env, _ctx, _config) {
    return null; // nothing to author — the artifact's own test config drives the run
  },

  async deliver(env, ctx, _config) {
    const cfg = await getTestConfig(env, ctx.artifactId);
    if (!cfg?.enabled) return { success: true }; // tests turned off → nothing to do

    const dep = await env.DB.prepare(`
      SELECT d.version_id, a.workspace_id
      FROM deployments d JOIN artifacts a ON a.id = d.artifact_id
      WHERE d.artifact_id = ? AND d.channel = 'production'
    `).bind(ctx.artifactId).first<{ version_id: string; workspace_id: string | null }>();
    if (!dep?.version_id) return { success: false, error: 'no live version to test' };

    const outcome = await runTests(env, {
      artifactId: ctx.artifactId,
      workspaceId: dep.workspace_id ?? '',
      versionId: dep.version_id,
      trigger: 'schedule',
      triggeredBy: null,
    });
    if (!outcome) return { success: true }; // tests disabled between the check and the run

    const status = outcome.run.status;
    if (status === 'passed') return { success: true };
    return { success: false, error: `scheduled tests ${status}` };
  },
};
