import type { Env } from '../types';

export interface AdminWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  owner: string;
  overrideCount: number;
}

// Count of explicit feature-flag overrides on a workspace's sparse JSON map.
function countOverrides(raw: string | null): number {
  if (!raw) return 0;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.values(obj).filter((v) => typeof v === 'boolean').length;
  } catch {
    return 0;
  }
}

export async function searchWorkspaces(
  env: Env,
  search: string,
  limit = 50,
  offset = 0
): Promise<{ workspaces: AdminWorkspaceRow[]; total: number }> {
  const where = search ? 'WHERE w.name LIKE ?1 OR w.slug LIKE ?1' : '';
  const like = `%${search}%`;

  const totalStmt = env.DB.prepare(`SELECT COUNT(*) AS n FROM workspaces w ${where}`);
  const total = (await (search ? totalStmt.bind(like) : totalStmt).first<{ n: number }>())?.n ?? 0;

  const stmt = env.DB.prepare(
    `SELECT w.id, w.name, w.slug, w.feature_flags AS featureFlags,
            COALESCE(u.email, u.name, 'unknown') AS owner
     FROM workspaces w
     LEFT JOIN users u ON u.id = w.owner_id
     ${where}
     ORDER BY w.created_at DESC
     LIMIT ? OFFSET ?`
  );
  const bound = search ? stmt.bind(like, limit, offset) : stmt.bind(limit, offset);
  const rows = await bound.all<{ id: string; name: string; slug: string; owner: string; featureFlags: string | null }>();
  const workspaces = (rows.results || []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    owner: r.owner,
    overrideCount: countOverrides(r.featureFlags),
  }));
  return { workspaces, total };
}
