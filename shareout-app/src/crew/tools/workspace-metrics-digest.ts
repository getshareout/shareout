import { checkDigestAccess, gatherWorkspaceMetricsDigest } from '../../workspaces/metrics-digest';
import type { CrewTool } from '../types';

export const workspaceMetricsDigestTool: CrewTool = {
  name: 'workspace_metrics_digest',
  mode: 'read',
  defaultApproval: 'never',
  description:
    "Weekly picture of THIS artifact's workspace: artifacts created/updated/deleted, views (top pages, member viewers, external vs internal), people (active creators/viewers, new members), AI usage and cost, scheduled job and crew runs, storage, and usefulness signals (comments, action items, shares, returning viewers, dormant pages). Includes the previous period for deltas and the workspace admins' emails. Only works when the crew owner is an owner/admin of the workspace.",
  input_schema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['last_days', 'previous_week'],
        description: '"previous_week" = last full Monday→Monday week in tz_offset_minutes; "last_days" (default) = the last `days` days ending now.',
      },
      days: { type: 'number', description: 'Window length for period "last_days". Default 7, max 31.' },
      tz_offset_minutes: { type: 'number', description: 'UTC offset for week boundaries, e.g. -180 for UTC-3. Default 0.' },
      compare: { type: 'boolean', description: 'Include the previous period of the same length and deltas. Default true.' },
    },
  },
  async execute(ctx, input) {
    const env = ctx.data.env;
    const workspaceId = ctx.principal.workspaceId;
    const denied = await checkDigestAccess(env, workspaceId, ctx.principal.ownerId);
    if (denied) return { error: denied };
    return gatherWorkspaceMetricsDigest(env, workspaceId, {
      period: input.period === 'previous_week' ? 'previous_week' : 'last_days',
      days: typeof input.days === 'number' ? input.days : undefined,
      tzOffsetMinutes: typeof input.tz_offset_minutes === 'number' ? input.tz_offset_minutes : 0,
      compare: input.compare !== false,
    });
  },
};
