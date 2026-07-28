import type { CrewTool } from '../types';

interface ActionItemRow {
  id: string;
  content: string;
  assignee_email: string;
  due_at: string | null;
  resolved: number;
  resolved_by: string | null;
  resolved_at: string | null;
  author_name: string;
  created_at: string;
}

export const actionItemListTool: CrewTool = {
  name: 'action_item_list',
  mode: 'read',
  description:
    'List action items (assigned comments) on this artifact with status and due dates.',
  input_schema: {
    type: 'object',
    properties: {
      include_resolved: { type: 'boolean', description: 'Include resolved action items. Default false.' },
      assignee_email: { type: 'string', description: 'Optional filter: only action items for this assignee.' },
    },
  },
  async execute(ctx, input) {
    const includeResolved = input.include_resolved === true;
    const assigneeFilter = typeof input.assignee_email === 'string' ? input.assignee_email.trim().toLowerCase() : null;

    let sql =
      `SELECT id, content, assignee_email, due_at, resolved, resolved_by, resolved_at, author_name, created_at ` +
      `FROM artifact_comments WHERE artifact_id = ? AND assignee_email IS NOT NULL`;
    const bindings: unknown[] = [ctx.data.artifactId];

    if (!includeResolved) {
      sql += ` AND resolved = 0`;
    }
    if (assigneeFilter) {
      sql += ` AND lower(assignee_email) = ?`;
      bindings.push(assigneeFilter);
    }
    sql += ` ORDER BY due_at ASC NULLS LAST, created_at DESC LIMIT 100`;

    const result = await ctx.data.env.DB.prepare(sql)
      .bind(...bindings)
      .all<ActionItemRow>();

    return result.results.map((r) => ({
      id: r.id,
      content: r.content,
      assigneeEmail: r.assignee_email,
      dueAt: r.due_at ?? null,
      resolved: r.resolved === 1,
      resolvedBy: r.resolved_by ?? null,
      resolvedAt: r.resolved_at ?? null,
      authorName: r.author_name,
      createdAt: r.created_at,
    }));
  },
};
