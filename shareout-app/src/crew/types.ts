import type { DataContext } from '../data/middleware';

// ── D1 row shapes (control plane) ──────────────────────────────────────────

export interface CrewRow {
  id: string;
  artifact_id: string;
  workspace_id: string | null;
  owner_id: string;
  name: string | null;
  instructions: string | null;
  model: string;
  status: string;
  max_iterations: number;
  max_tokens_per_call: number;
  run_budget_micro_usd: number;
  max_runtime_ms: number;
  created_at: string;
  updated_at: string;
}

export interface CrewRunRow {
  id: string;
  crew_id: string;
  artifact_id: string;
  trigger_kind: string;
  initiated_by: string | null;
  status: string;
  termination_reason: string | null;
  input_json: string | null;
  result_text: string | null;
  iterations: number;
  token_input: number;
  token_output: number;
  cost_micro_usd: number;
  started_at: string;
  ended_at: string | null;
}

export interface CrewApprovalRow {
  id: string;
  crew_id: string;
  run_id: string;
  artifact_id: string;
  tool_name: string;
  input_json: string;
  status: string; // pending | approved | rejected | executed | failed
  result_json: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface CrewTriggerRow {
  id: string;
  crew_id: string;
  artifact_id: string;
  kind: string; // cron | event (condition reserved for Phase 3)
  cron: string | null;
  event_type: string | null;
  condition_json: string | null;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Runtime ────────────────────────────────────────────────────────────────

export type TerminationReason =
  | 'goal_met'
  | 'max_iterations'
  | 'budget_exhausted'
  | 'timeout'
  | 'awaiting_approval'
  | 'abandoned'
  | 'error';

export interface RunCaps {
  maxIterations: number;
  maxTokensPerCall: number;
  maxRuntimeMs: number;
  runBudgetMicroUsd: number;
}

export interface ToolLimits {
  maxRows?: number;
  maxCalls?: number;
  maxBytes?: number;
  maxResults?: number;
}

/** Identifies a crew as the acting principal — stamped on every ledger row. */
export interface CrewPrincipal {
  crewId: string;
  runId: string;
  ownerId: string;
  artifactId: string;
  workspaceId: string;
}

/** Context handed to a tool executor. `data` carries the crew's data scope. */
export interface CrewToolCtx {
  data: DataContext;
  principal: CrewPrincipal;
  limits: ToolLimits;
}

export type ApprovalPolicy = 'never' | 'always' | 'whenPublic';

export interface CrewTool {
  name: string;
  mode: 'read' | 'write';
  description: string;
  input_schema: Record<string, unknown>;
  /** Default approval policy for write tools (owner can override per grant). */
  defaultApproval?: ApprovalPolicy;
  execute(ctx: CrewToolCtx, input: Record<string, unknown>): Promise<unknown>;
}

// ── SSE wire events (field names mirror app-chat for SDK familiarity) ───────

export type CrewSseEvent =
  | { type: 'run_start'; runId: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; result: unknown; is_error?: boolean }
  | { type: 'finish'; summary: string; status: string }
  | { type: 'error'; error: string }
  | {
      type: 'done';
      runId: string;
      terminationReason: TerminationReason;
      iterations: number;
      costMicroUsd: number;
    };
