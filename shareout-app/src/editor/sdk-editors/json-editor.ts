import { createMiniDb, type MiniDb } from '../../data/minidb-client';
import { generateId } from '../../crypto-utils';
import { dispatchAction } from './dispatch';
import { errorResponse, jsonResponse } from './response';
import type { SDKEditorHandler } from './types';

// The per-artifact JSON store lives in the MiniDB Durable Object (ADR 28); the
// shared-D1 `artifact_json` table was dropped in migration 0039. Queries here
// mirror the canonical store in src/data/json-store.ts (same DO, same schema).
const KEY_PATTERN = /^[a-zA-Z0-9_\-.]+$/;
const MAX_VALUE_SIZE = 1_000_000;

function valueType(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

/** Read + JSON.parse a single JSON-store key from the per-artifact MiniDB. */
export async function readJsonValue<T = unknown>(db: MiniDb, artifactId: string, key: string): Promise<T | null> {
  const row = await db.prepare(
    'SELECT value FROM artifact_json WHERE artifact_id = ? AND key = ?'
  ).bind(artifactId, key).first<{ value: string }>();
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as T; } catch { return row.value as unknown as T; }
}

/** Upsert a single JSON-store key (mirrors src/data/json-store.ts setKey). */
export async function writeJsonValue(db: MiniDb, artifactId: string, key: string, value: unknown): Promise<void> {
  const valueStr = JSON.stringify(value ?? null);
  const sizeBytes = new TextEncoder().encode(valueStr).length;
  const now = new Date().toISOString();
  const existing = await db.prepare(
    'SELECT id FROM artifact_json WHERE artifact_id = ? AND key = ?'
  ).bind(artifactId, key).first<{ id: string }>();
  if (existing) {
    await db.prepare(
      'UPDATE artifact_json SET value = ?, size_bytes = ?, updated_at = ? WHERE id = ?'
    ).bind(valueStr, sizeBytes, now, existing.id).run();
  } else {
    await db.prepare(
      'INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(generateId('jsn'), artifactId, key, valueStr, sizeBytes, now, now).run();
  }
}

export const handleJSONEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;
  const db = createMiniDb(env, artifactId, '');

  return dispatchAction(action, {
    get: async () => {
      const rows = await db.prepare(
        'SELECT key, value, updated_at FROM artifact_json WHERE artifact_id = ? ORDER BY key LIMIT 500'
      ).bind(artifactId).all<{ key: string; value: string; updated_at: string }>();

      return jsonResponse({
        success: true,
        keys: rows.results.map((r) => {
          let parsed: unknown;
          try { parsed = JSON.parse(r.value); } catch { parsed = r.value; }
          return { key: r.key, value: parsed, type: valueType(parsed), updatedAt: r.updated_at };
        }),
      });
    },

    set: async () => {
      let body: { key?: string; value?: unknown };
      try {
        body = await request.json() as { key?: string; value?: unknown };
      } catch {
        return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400);
      }
      if (!body.key || !KEY_PATTERN.test(body.key)) {
        return errorResponse('INVALID_REQUEST', 'Valid key required (a-z, A-Z, 0-9, _, -, .)', 400);
      }
      const sizeBytes = new TextEncoder().encode(JSON.stringify(body.value ?? null)).length;
      if (sizeBytes > MAX_VALUE_SIZE) {
        return errorResponse('VALUE_TOO_LARGE', `Value exceeds ${MAX_VALUE_SIZE / 1000}KB`, 400);
      }
      await writeJsonValue(db, artifactId, body.key, body.value ?? null);
      return jsonResponse({ success: true });
    },

    delete: async () => {
      let body: { key?: string };
      try {
        body = await request.json() as { key?: string };
      } catch {
        return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400);
      }
      if (!body.key) {
        return errorResponse('INVALID_REQUEST', 'key required', 400);
      }
      await db.prepare(
        'DELETE FROM artifact_json WHERE artifact_id = ? AND key = ?'
      ).bind(artifactId, body.key).run();
      return jsonResponse({ success: true });
    },
  });
};
