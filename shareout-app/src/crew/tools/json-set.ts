import { generateId } from '../../crypto-utils';
import type { CrewTool } from '../types';

export const jsonSetTool: CrewTool = {
  name: 'json_set',
  mode: 'write',
  defaultApproval: 'whenPublic',
  description:
    "Write a value into the app's key/value JSON store by key (creates or replaces). Optionally set a single field inside the key's object via `path`. Use to store a computed summary, status, or narrative the app reads.",
  input_schema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The key to write.' },
      value: { description: 'The JSON value to store (string, number, object, or array).' },
      path: { type: 'string', description: "Optional. Set this top-level field inside the key's object instead of replacing the whole key." },
    },
    required: ['key', 'value'],
  },
  async execute(ctx, input) {
    // Mirror the json-store policy guard: when a row-level access policy is active
    // (viewerScope set), the JSON store is owner/editor-only.
    if (ctx.data.viewerScope) {
      return { error: 'This artifact has a row-level access policy; the JSON store is restricted to owners.' };
    }

    const key = typeof input.key === 'string' ? input.key : '';
    if (!key) return { error: 'Missing required field "key".' };
    if (!('value' in input)) return { error: 'Missing required field "value".' };
    const path = typeof input.path === 'string' ? input.path : undefined;

    const db = ctx.data.db;
    let toStore: unknown = input.value;
    if (path) {
      const existing = await db.prepare('SELECT value FROM artifact_json WHERE artifact_id = ? AND key = ?')
        .bind(ctx.data.artifactId, key).first<{ value: string }>();
      let obj: Record<string, unknown> = {};
      if (existing) {
        try {
          const parsed = JSON.parse(existing.value);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
        } catch { /* overwrite a non-object value */ }
      }
      obj[path] = input.value;
      toStore = obj;
    }

    const json = JSON.stringify(toStore);
    const size = new TextEncoder().encode(json).length;
    if (size > 1_000_000) return { error: 'Value exceeds the 1MB per-key limit; materialize to a dataset/table instead.' };
    const now = new Date().toISOString();

    const ex = await db.prepare('SELECT id FROM artifact_json WHERE artifact_id = ? AND key = ?')
      .bind(ctx.data.artifactId, key).first<{ id: string }>();
    if (ex) {
      await db.prepare('UPDATE artifact_json SET value = ?, size_bytes = ?, updated_at = ? WHERE id = ?')
        .bind(json, size, now, ex.id).run();
    } else {
      await db.prepare('INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(generateId('jsn'), ctx.data.artifactId, key, json, size, now, now).run();
    }
    return { key, bytes: size, ...(path ? { path } : {}) };
  },
};
