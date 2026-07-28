import type { Env } from '../types';
import type { CrewTool, ToolLimits } from './types';
import { tableQueryTool } from './tools/table-query';
import { tableSchemaTool } from './tools/table-schema';
import { jsonGetTool } from './tools/json-get';
import { fileListTool } from './tools/file-list';
import { fileReadTool } from './tools/file-read';
import { jsonSetTool } from './tools/json-set';
import { commentCreateTool } from './tools/comment-create';
import { actionItemCreateTool } from './tools/action-item-create';
import { actionItemListTool } from './tools/action-item-list';
import { tableInsertTool } from './tools/table-insert';
import { tableUpdateTool } from './tools/table-update';
import { emailSendTool } from './tools/email-send';
import { webSearchTool } from './tools/web-search';
import { connectionQueryTool } from './tools/connection-query';
import { materializeTool } from './tools/materialize';
import { scheduledJobCreateTool } from './tools/scheduled-job-create';
import { notifySendTool } from './tools/notify-send';
import { platformMetricsDigestTool } from './tools/platform-metrics-digest';
import { adminTelegramNotifyTool } from './tools/admin-telegram-notify';
import { adminTelegramBriefTool } from './tools/admin-telegram-brief';
import { platformMetricsInvestigateTool } from './tools/platform-metrics-investigate';
import { pilotVerifyTool } from './tools/pilot-verify';

/** Every tool the Crew runtime knows about. */
export const CREW_TOOLS: Record<string, CrewTool> = {
  // read (Phase 0)
  [tableQueryTool.name]: tableQueryTool,
  [tableSchemaTool.name]: tableSchemaTool,
  [jsonGetTool.name]: jsonGetTool,
  // read (workspace file library — work/042 P4)
  [fileListTool.name]: fileListTool,
  [fileReadTool.name]: fileReadTool,
  // read, external (Phase 2.1)
  [webSearchTool.name]: webSearchTool,
  [connectionQueryTool.name]: connectionQueryTool,
  // read (action items)
  [actionItemListTool.name]: actionItemListTool,
  // write (Phase 2)
  [commentCreateTool.name]: commentCreateTool,
  [actionItemCreateTool.name]: actionItemCreateTool,
  [tableInsertTool.name]: tableInsertTool,
  [tableUpdateTool.name]: tableUpdateTool,
  [jsonSetTool.name]: jsonSetTool,
  [emailSendTool.name]: emailSendTool,
  // write, external (Phase 2.1)
  [materializeTool.name]: materializeTool,
  [scheduledJobCreateTool.name]: scheduledJobCreateTool,
  [notifySendTool.name]: notifySendTool,
  [pilotVerifyTool.name]: pilotVerifyTool,
  // super-admin ops (platform owner crews only)
  [platformMetricsDigestTool.name]: platformMetricsDigestTool,
  [platformMetricsInvestigateTool.name]: platformMetricsInvestigateTool,
  [adminTelegramBriefTool.name]: adminTelegramBriefTool,
  [adminTelegramNotifyTool.name]: adminTelegramNotifyTool,
};

export interface ResolvedGrant {
  tool: CrewTool;
  limits: ToolLimits;
  approvalPolicy: string;
}

/**
 * Server-authoritative tool resolution: only tools the owner enabled are
 * exposed to the model, each with its stored approval policy. HTML can request
 * tools via define(), but the stored grant is what the runtime enforces — HTML
 * can never widen it.
 */
export async function resolveEnabledTools(env: Env, crewId: string): Promise<ResolvedGrant[]> {
  const result = await env.DB.prepare(
    `SELECT tool_name, mode, approval_policy, limits_json FROM crew_grants WHERE crew_id = ? AND enabled = 1`
  ).bind(crewId).all<{ tool_name: string; mode: string; approval_policy: string; limits_json: string | null }>();

  const grants: ResolvedGrant[] = [];
  for (const row of result.results) {
    const tool = CREW_TOOLS[row.tool_name];
    if (!tool || tool.mode !== row.mode) continue;
    let limits: ToolLimits = {};
    if (row.limits_json) {
      try {
        limits = JSON.parse(row.limits_json) as ToolLimits;
      } catch {
        /* keep defaults */
      }
    }
    grants.push({ tool, limits, approvalPolicy: row.approval_policy || 'never' });
  }
  return grants;
}

/** Project tools to the neutral provider tool shape ({ name, description, input_schema }). */
export function toProviderTools(
  tools: CrewTool[]
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}
