import { createMiniDb, type MiniDb } from '../../data/minidb-client';
import { readJsonValue } from './json-editor';
import { dispatchAction } from './dispatch';
import { jsonResponse } from './response';
import type { SDKEditorContext, SDKEditorHandler } from './types';

export const handleBindingEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env, component } = ctx;
  const db = createMiniDb(env, artifactId, '');

  return dispatchAction(action, {
    get: async () => {
      return jsonResponse({
        success: true,
        binding: {
          raw: component.config?.binding || '',
          display: component.config?.display || component.name || 'Unknown',
          type: detectBindingType(component.config?.binding as string),
          sources: extractBindingSources(component.config?.binding as string),
        },
      });
    },

    resolve: async () => {
      const binding = component.config?.binding as string;
      if (!binding) {
        return jsonResponse({ success: true, sources: [] });
      }

      const sources = await resolveBindingSources(binding, artifactId, db);
      return jsonResponse({ success: true, sources });
    },
  });
};

function detectBindingType(binding: string | undefined): string {
  if (!binding) return 'unknown';
  if (binding.startsWith('json:')) return 'json';
  if (binding.startsWith('table:')) return 'table';
  if (binding.startsWith('computed:')) return 'computed';
  if (binding.startsWith('multi:')) return 'multi';
  return 'unknown';
}

function extractBindingSources(binding: string | undefined): string[] {
  if (!binding) return [];
  const sources: string[] = [];

  if (binding.startsWith('json:')) {
    const key = binding.slice(5).split('.')[0];
    sources.push(`json:${key}`);
  } else if (binding.startsWith('table:')) {
    const parts = binding.split(':');
    if (parts[1]) sources.push(`table:${parts[1]}`);
  } else if (binding.startsWith('computed:')) {
    const parts = binding.split(':');
    if (parts[2]) {
      parts[2].split('+').forEach(s => {
        sources.push(...extractBindingSources(s));
      });
    }
  } else if (binding.startsWith('multi:')) {
    const parts = binding.split(':');
    if (parts[2]) {
      parts[2].split('|').forEach(s => {
        sources.push(...extractBindingSources(s));
      });
    }
  }

  return [...new Set(sources)];
}

// Resolves against the per-artifact MiniDB (ADR 28) — json/table data live there,
// not in shared D1. Mirrors src/data/json-store.ts and src/data/tables.ts schemas.
async function resolveBindingSources(
  binding: string,
  artifactId: string,
  db: MiniDb
): Promise<Array<{ type: string; name: string; data?: unknown }>> {
  const sources = extractBindingSources(binding);
  const resolved: Array<{ type: string; name: string; data?: unknown }> = [];

  for (const source of sources) {
    if (source.startsWith('json:')) {
      const key = source.slice(5);
      const value = await readJsonValue(db, artifactId, key);
      resolved.push({ type: 'json', name: key, data: value });
    } else if (source.startsWith('table:')) {
      const tableName = source.slice(6);
      const table = await db.prepare(
        'SELECT row_count FROM artifact_tables WHERE artifact_id = ? AND name = ?'
      ).bind(artifactId, tableName).first<{ row_count: number }>();
      resolved.push({
        type: 'table',
        name: tableName,
        data: { rowCount: table?.row_count || 0 },
      });
    }
  }

  return resolved;
}
