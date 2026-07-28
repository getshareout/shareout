import { createJob, type JobAction, type JobConfig } from '../../scheduling/jobs';
import type { CrewTool } from '../types';

export const scheduledJobCreateTool: CrewTool = {
  name: 'scheduled_job_create',
  mode: 'write',
  defaultApproval: 'always',
  description:
    'Create a recurring scheduled job for this app (e.g. a weekly email, a webhook, or a materialize). High-impact — always requires owner approval.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['email', 'webhook', 'slack', 'discord', 'http_get', 'materialize'],
        description: 'What the job does.',
      },
      schedule: { type: 'string', description: '5-field cron expression, e.g. "0 9 * * 1" (Mondays 9am UTC).' },
      config: { type: 'object', description: 'Action-specific configuration.' },
      title: { type: 'string', description: 'Short human name for this schedule, e.g. "Weekly revenue email".' },
      description: { type: 'string', description: 'One-line description of what this schedule does and why.' },
    },
    required: ['action', 'schedule', 'config'],
  },
  async execute(ctx, input) {
    const action = input.action as JobAction;
    const schedule = typeof input.schedule === 'string' ? input.schedule : '';
    const config = input.config as JobConfig;
    if (!action || !schedule || !config || typeof config !== 'object') {
      return { error: 'Provide "action", "schedule" (cron), and "config".' };
    }
    const { job, error } = await createJob(ctx.data.env, ctx.principal.ownerId, {
      artifact_id: ctx.data.artifactId,
      action,
      schedule,
      trigger_type: 'cron',
      config,
      title: typeof input.title === 'string' ? input.title : undefined,
      description: typeof input.description === 'string' ? input.description : undefined,
    });
    if (error) return { error };
    return { jobId: job?.id, schedule, nextRunAt: job?.next_run_at };
  },
};
