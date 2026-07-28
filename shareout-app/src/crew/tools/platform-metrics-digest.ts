import { requireSuperAdminOwner } from './superadmin-guard';
import { defaultReportDate, getDailyPlatformDigest } from '../../superadmin/digest';
import type { CrewTool } from '../types';

export const platformMetricsDigestTool: CrewTool = {
  name: 'platform_metrics_digest',
  mode: 'read',
  defaultApproval: 'never',
  description:
    'Fetch the executive daily platform digest: marketing funnel, product usage, workspace activity, economics, health, and pre-computed signals. Super-admin only. Start every CEO morning report here.',
  input_schema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Report calendar day as YYYY-MM-DD (UTC). Omit for yesterday.',
      },
    },
  },
  async execute(ctx, input) {
    const denied = await requireSuperAdminOwner(ctx.data.env, ctx.principal.ownerId);
    if (denied) return { error: denied };

    const date =
      typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
        ? input.date
        : defaultReportDate();
    return getDailyPlatformDigest(ctx.data.env, date);
  },
};
