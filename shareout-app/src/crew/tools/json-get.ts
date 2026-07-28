import type { CrewTool } from '../types';

export const jsonGetTool: CrewTool = {
  name: 'json_get',
  mode: 'read',
  description: "Read a value from the app's key/value JSON store by key. Read-only.",
  input_schema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The key to read.' },
    },
    required: ['key'],
  },
  async execute(ctx, input) {
    // Mirror the json-store policy guard: when a row-level access policy is
    // active (viewerScope set), the JSON store is owner/editor-only.
    if (ctx.data.viewerScope) {
      return { error: 'This artifact has a row-level access policy; the JSON store is restricted to owners.' };
    }

    const key = typeof input.key === 'string' ? input.key : '';
    if (!key) return { error: 'Missing required field "key".' };

    const row = await ctx.data.db
      .prepare('SELECT key, value, updated_at FROM artifact_json WHERE artifact_id = ? AND key = ?')
      .bind(ctx.data.artifactId, key)
      .first<{ key: string; value: string; updated_at: string }>();

    if (!row) return { error: `Key "${key}" not found.` };

    return { key: row.key, value: JSON.parse(row.value), updatedAt: row.updated_at };
  },
};
