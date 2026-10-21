import type { AccountTool } from './types';
import type { ActionProposal } from './actions';

/** "Watch revenue on this dashboard" → a zero-config anomaly watch. */
export const watchMetricTool: AccountTool = {
  name: 'watch_metric',
  description:
    "Watch a metric on a table-backed artifact and get a notification when it moves sharply (≥ threshold_pct, default 20%, either direction). The metric is dead simple: row count of a table, sum of a numeric column, or the last value of a column. Use when the user says 'watch/alert me on X on this dashboard'. Checked hourly; the workspace bell is notified on a big move.",
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string', description: 'The artifact (dashboard) whose table holds the metric.' },
      table: { type: 'string', description: 'Name of the table in the artifact to read.' },
      kind: { type: 'string', enum: ['count', 'sum', 'last'], description: 'count = number of rows; sum = total of a numeric column; last = latest row\'s value of a column.' },
      column: { type: 'string', description: 'The numeric column (required for kind=sum and kind=last).' },
      threshold_pct: { type: 'number', description: 'Alert when the value moves at least this percent vs the last check. Default 20.' },
    },
    required: ['artifact_id', 'table', 'kind'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id.trim() : '';
    if (!artifactId) return { error: 'Tell me which artifact to watch (artifact_id).' };
    const { artifact_id: _id, ...spec } = input;
    const row = await ctx.env.DB.prepare('SELECT name FROM artifacts WHERE id = ?').bind(artifactId).first<{ name: string }>();
    if (!row) return { error: 'Artifact not found' };
    const proposal: ActionProposal = { __propose: { kind: 'watch_metric', artifactId, artifactName: row.name?.trim() || 'page', spec } };
    return proposal;
  },
};
