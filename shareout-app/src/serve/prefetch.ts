import type { Env } from '../types';
import { createMiniDb } from '../data/minidb-client';
import { getCommentsViewerConfig } from './comments-config';
import type { InitialJsonData, InitialTableData, AdminInfo } from './types';

/** Authenticated viewer resolved once per request and threaded into the detectors. */
type SessionUser = { id: string; email: string };

const MAX_INITIAL_JSON_KEYS = 20;
const MAX_INITIAL_JSON_SIZE = 50 * 1024; // 50KB max for initial data
const MAX_INITIAL_TABLE_ROWS = 100;
const MAX_INITIAL_TABLES = 5;

export async function fetchInitialJsonData(env: Env, artifactId: string): Promise<InitialJsonData | null> {
  try {
    const db = createMiniDb(env, artifactId, '');
    const result = await db.prepare(`
      SELECT key, value FROM artifact_json
      WHERE artifact_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).bind(artifactId, MAX_INITIAL_JSON_KEYS).all<{ key: string; value: string }>();

    if (!result.results || result.results.length === 0) {
      return null;
    }

    const data: Record<string, unknown> = {};
    let totalSize = 0;

    for (const row of result.results) {
      const valueSize = row.value.length;
      if (totalSize + valueSize > MAX_INITIAL_JSON_SIZE) break;

      try {
        data[row.key] = JSON.parse(row.value);
        totalSize += valueSize;
      } catch {
        // Skip invalid JSON
      }
    }

    return {
      keys: Object.keys(data),
      data,
    };
  } catch {
    return null;
  }
}

export async function fetchInitialTableData(env: Env, artifactId: string): Promise<InitialTableData | null> {
  try {
    const db = createMiniDb(env, artifactId, '');
    const tables = await db.prepare(`
      SELECT id, name, row_count FROM artifact_tables
      WHERE artifact_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).bind(artifactId, MAX_INITIAL_TABLES).all<{ id: string; name: string; row_count: number }>();

    if (!tables.results || tables.results.length === 0) {
      return null;
    }

    const data: Record<string, { rows: unknown[]; total: number; hasMore: boolean }> = {};

    // One batched hop for all ≤MAX_INITIAL_TABLES per-table row reads (opt-001).
    const rowResults = await db.batch(
      tables.results.map((table) => ({
        sql: `
        SELECT data FROM artifact_rows
        WHERE table_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
        bindings: [table.id, MAX_INITIAL_TABLE_ROWS],
        mode: 'all' as const,
      })),
    );

    tables.results.forEach((table, i) => {
      const parsedRows = ((rowResults[i]?.results ?? []) as { data: string }[])
        .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
        .filter(Boolean);

      data[table.name] = {
        rows: parsedRows,
        total: table.row_count,
        hasMore: table.row_count > MAX_INITIAL_TABLE_ROWS,
      };
    });

    return { tables: data };
  } catch {
    return null;
  }
}

export async function detectFavoriteState(
  user: SessionUser | null,
  env: Env,
  artifactId: string
): Promise<{ loggedIn: boolean; isFavorite: boolean }> {
  try {
    if (!user) return { loggedIn: false, isFavorite: false };

    const fav = await env.DB.prepare(
      'SELECT 1 FROM favorites WHERE artifact_id = ? AND user_id = ?'
    ).bind(artifactId, user.id).first();

    return { loggedIn: true, isFavorite: !!fav };
  } catch {
    return { loggedIn: false, isFavorite: false };
  }
}

export async function detectCommentsState(
  user: SessionUser | null,
  env: Env,
  artifactId: string
): Promise<{ loggedIn: boolean; enabled: boolean; count: number; identityMode: 'anonymous' | 'named' | 'authenticated' }> {
  try {
    const loggedIn = !!user;

    // Shared read-through KV cache, same key the raw-HTML path uses (no DO RPC on hit).
    const viewer = await getCommentsViewerConfig(env, artifactId);
    const enabled = viewer.enabled;

    let count = 0;
    if (enabled) {
      const row = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM artifact_comments WHERE artifact_id = ? AND resolved = 0 AND parent_id IS NULL'
      ).bind(artifactId).first<{ n: number }>();
      count = row?.n ?? 0;
    }

    return { loggedIn, enabled, count, identityMode: viewer.identityMode };
  } catch {
    return { loggedIn: false, enabled: false, count: 0, identityMode: 'anonymous' };
  }
}

/** Attached skills for a logged-in viewer (read-only chips in the viewer toolbar).
 *  Visitors can be workspace members with viewer access, so this is shown to any
 *  signed-in viewer — not just owners. Empty for anonymous views. */
export async function fetchAttachedSkills(
  user: SessionUser | null,
  env: Env,
  artifactId: string
): Promise<Array<{ name: string; slug: string }>> {
  try {
    if (!user) return [];
    const rows = await env.DB.prepare(
      `SELECT a.name, a.slug
         FROM artifact_skills s JOIN artifacts a ON a.id = s.skill_artifact_id
        WHERE s.artifact_id = ? AND a.deleted_at IS NULL
        ORDER BY s.position ASC, s.created_at ASC`
    ).bind(artifactId).all<{ name: string; slug: string }>();
    return rows.results ?? [];
  } catch {
    return [];
  }
}

export async function detectAdminStatus(
  user: SessionUser | null,
  env: Env,
  artifactId: string,
  ownerId: string | null
): Promise<AdminInfo | null> {
  try {
    if (!user) return null;

    // The session token already carries the verified user id; the artifact's owner
    // is its owner_id. Equal ids ⇒ owner, no D1 lookup needed.
    if (ownerId && user.id === ownerId) {
      return { isOwner: true, role: 'owner', canEdit: true };
    }

    const collab = await env.DB.prepare(
      'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
    ).bind(artifactId, user.email).first<{ role: string }>();

    if (collab) {
      const role = collab.role as 'owner' | 'editor' | 'viewer';
      return {
        isOwner: role === 'owner',
        role,
        canEdit: role === 'owner' || role === 'editor',
      };
    }

    return null;
  } catch {
    return null;
  }
}
