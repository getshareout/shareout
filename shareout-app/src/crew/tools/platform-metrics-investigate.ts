import { requireSuperAdminOwner } from './superadmin-guard';
import { investigatePlatformMetrics, type InvestigateTopic } from '../../superadmin/digest-investigate';
import { defaultReportDate } from '../../superadmin/digest';
import type { CrewTool } from '../types';

const TOPICS: InvestigateTopic[] = [
  'marketing_funnel',
  'workspace_detail',
  'top_artifacts',
  'user_logins',
  'errors',
  'ai_by_workspace',
  'publishes',
  'crew_activity',
];

export const platformMetricsInvestigateTool: CrewTool = {
  name: 'platform_metrics_investigate',
  mode: 'read',
  defaultApproval: 'never',
  description:
    'Drill into a specific area after reading the digest: marketing funnel breakdown, per-workspace activity, top artifacts, user logins/signups, errors, AI spend by workspace, publishes, or crew runs. Super-admin only. Call 1–3 times to double-click anything surprising.',
  input_schema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: TOPICS,
        description: 'Which area to investigate in depth.',
      },
      date: { type: 'string', description: 'YYYY-MM-DD (UTC). Omit for yesterday.' },
      workspace: {
        type: 'string',
        description: 'Filter workspace_detail by name or slug substring.',
      },
      limit: { type: 'number', description: 'Max rows (default 10, max 25).' },
    },
    required: ['topic'],
  },
  async execute(ctx, input) {
    const denied = await requireSuperAdminOwner(ctx.data.env, ctx.principal.ownerId);
    if (denied) return { error: denied };

    const topic = String(input.topic || '') as InvestigateTopic;
    if (!TOPICS.includes(topic)) return { error: `topic must be one of: ${TOPICS.join(', ')}` };

    const date =
      typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
        ? input.date
        : defaultReportDate();

    return investigatePlatformMetrics(ctx.data.env, {
      topic,
      date,
      workspace: typeof input.workspace === 'string' ? input.workspace : undefined,
      limit: typeof input.limit === 'number' ? input.limit : undefined,
    });
  },
};
