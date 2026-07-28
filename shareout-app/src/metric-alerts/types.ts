// Follow Metric Alerts — shared types.

/** Where a metric's number comes from. Server-evaluable without rendering the page. */
export type MetricSource =
  | { type: 'json_path'; key: string; path: string }
  | { type: 'table_count'; table: string; where?: Record<string, unknown> }
  | {
      type: 'table_aggregate';
      table: string;
      field: string;
      fn: 'sum' | 'avg' | 'min' | 'max';
      where?: Record<string, unknown>;
    };

export type AlertOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'change_pct_gt' | 'change_pct_lt';

export interface AlertCondition {
  op: AlertOp;
  value: number;
}

export interface MetricDefinition {
  id: string;
  artifact_id: string;
  workspace_id: string | null;
  metric_id: string;
  label: string;
  format: string | null;
  source: MetricSource;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type AlertDestinationKind = 'slack' | 'email' | 'discord' | 'webhook' | 'http_get' | 'telegram';

/** Optional follow-up when an alert fires. crew = run the artifact's crew to investigate. */
export interface OnTrigger {
  crew: boolean;
  instruction?: string;
}

export interface MetricAlertRule {
  id: string;
  artifact_id: string;
  workspace_id: string | null;
  metric_id: string;
  owner_id: string;
  name: string;
  condition: AlertCondition;
  schedule: string;
  destination_kind: AlertDestinationKind;
  destination_config: Record<string, unknown>;
  message: string | null;
  cooldown_seconds: number;
  next_run_at: string;
  last_evaluated_at: string | null;
  last_value: number | null;
  last_triggered_at: string | null;
  last_triggered_value: number | null;
  last_status: 'ok' | 'matched' | 'delivered' | 'failed' | null;
  last_error: string | null;
  enabled: boolean;
  on_trigger: OnTrigger | null;
  created_at: string;
  /** Recent evaluated values, oldest→newest, for a trend sparkline (list views only). */
  history?: number[];
}
