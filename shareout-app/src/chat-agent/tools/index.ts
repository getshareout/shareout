import type { AccountTool } from './types';
import { listArtifactsTool, searchArtifactsTool, searchWorkspaceTool, readArtifactTool } from './artifacts';
import { listDataSourcesTool, runDataSourceTool } from './data-sources';
import { sendSnapshotTool, sendPdfTool } from './media';
import {
  listAlertsTool,
  listJobsTool,
  manageAlertTool,
  manageJobTool,
  shareArtifactTool,
  askCrewTool,
  editPageTool,
} from './actions';
import { addTableRowTool, updateTableRowTool, setJsonValueTool } from './data';
import { setClientNotesTool } from './client-notes';
import { listConnectionsTool, queryConnectionTool } from './connection-query';
import { createScheduleTool } from './create-schedule';
import { createArtifactTool } from './build';
import { catalogSearchTool, catalogGetTool } from './catalog';
import { knowledgeSearchTool, knowledgeGetTool } from './knowledge';
import { listFilesTool, readFileTool } from './files';
import { watchMetricTool } from './watch-metric';
import { presentArtifactTool } from './present-artifact';

import type { PlatformId } from '../../chat-platforms/types';

export type { AccountTool, ToolContext } from './types';

// Read + media + write tools every surface always gets. Write tools
// (manage_alert/job, share, ask_crew, edit_page, add/update_table_row,
// set_json_value) return a proposal the user must confirm with a button tap
// before it runs — see actions.ts and the chat coordinator's approval flow.
export const ACCOUNT_TOOLS: AccountTool[] = [
  listArtifactsTool,
  searchArtifactsTool,
  searchWorkspaceTool,
  readArtifactTool,
  listDataSourcesTool,
  runDataSourceTool,
  sendSnapshotTool,
  sendPdfTool,
  listAlertsTool,
  listJobsTool,
  manageAlertTool,
  manageJobTool,
  shareArtifactTool,
  askCrewTool,
  editPageTool,
  addTableRowTool,
  updateTableRowTool,
  setJsonValueTool,
  setClientNotesTool,
  catalogSearchTool,
  catalogGetTool,
  knowledgeSearchTool,
  knowledgeGetTool,
  listFilesTool,
  readFileTool,
  watchMetricTool,
  presentArtifactTool,
];

// Capability-gated tool groups. A surface opts into each via Capabilities
// instead of branching on platform id.
export const CONNECTOR_TOOLS: AccountTool[] = [listConnectionsTool, queryConnectionTool];
export const SCHEDULE_TOOLS: AccountTool[] = [createScheduleTool];
export const BUILD_TOOLS: AccountTool[] = [createArtifactTool];

/**
 * Per-surface powers. Replaces hardcoded `platform === 'web'` checks so every
 * surface (web, telegram, slack, visitor) declares what it can do.
 */
export interface Capabilities {
  /** Ad-hoc read-only SQL against workspace connectors (list_connections, query_connection). */
  canQueryConnections: boolean;
  /** Set up recurring scheduled sends (create_schedule). */
  canSchedule: boolean;
  /** Build & publish brand-new artifacts from a prompt (create_artifact). */
  canBuild: boolean;
}

/**
 * Default capability set for a surface. The account chat surfaces (web home,
 * telegram, slack) are all fully powered — connectors, scheduling, and building.
 * The visitor agent passes its own locked-down set instead of relying on this.
 */
export function defaultCapabilities(_platform: PlatformId): Capabilities {
  return { canQueryConnections: true, canSchedule: true, canBuild: true };
}

/** The tool set for a turn: always-on account tools plus capability-gated groups. */
export function selectTools(caps: Capabilities): AccountTool[] {
  const tools = [...ACCOUNT_TOOLS];
  if (caps.canQueryConnections) tools.push(...CONNECTOR_TOOLS);
  if (caps.canSchedule) tools.push(...SCHEDULE_TOOLS);
  if (caps.canBuild) tools.push(...BUILD_TOOLS);
  return tools;
}
