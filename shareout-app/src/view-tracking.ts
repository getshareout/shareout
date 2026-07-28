import type { Env } from './types';

export interface ViewerTrackingEntry {
  email: string;
  name: string | null;
  role: string;
  hasViewed: boolean;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
}

export async function trackViewerView(
  env: Env,
  artifactId: string,
  email: string,
  path?: string,
  isOwner?: boolean
): Promise<void> {
  // Record every authenticated viewer by email (collaborators, workspace
  // members, external sharees). The owner's own views are skipped so the
  // breakdown reads as "who did I share this with, and did they open it".
  if (isOwner) return;
  try {
    await env.DB.prepare(`
      INSERT INTO viewer_view_events (id, artifact_id, email, path)
      VALUES (?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      artifactId,
      email,
      path || '/'
    ).run();
  } catch {
    // Silent fail — tracking must not break serving
  }
}

export async function getViewerTracking(
  env: Env,
  artifactId: string
): Promise<ViewerTrackingEntry[]> {
  try {
    // Union of everyone who has actually viewed (any authenticated email in
    // viewer_view_events) plus collaborators who were invited but haven't
    // opened yet. Role/name are resolved by left joins. Ordered by most
    // recent view first; invited-not-viewed (NULL last view) fall to the end.
    const result = await env.DB.prepare(`
      SELECT
        e.email AS email,
        u.name AS name,
        COALESCE(c.role, '') AS role,
        COUNT(v.id) AS view_count,
        MIN(v.viewed_at) AS first_viewed_at,
        MAX(v.viewed_at) AS last_viewed_at
      FROM (
        SELECT DISTINCT email FROM viewer_view_events WHERE artifact_id = ?1
        UNION
        SELECT email FROM collaborators
          WHERE artifact_id = ?1 AND role IN ('viewer', 'editor')
      ) e
      LEFT JOIN collaborators c
        ON c.artifact_id = ?1 AND c.email = e.email
      LEFT JOIN viewer_view_events v
        ON v.artifact_id = ?1 AND v.email = e.email
      LEFT JOIN users u ON u.email = e.email
      GROUP BY e.email
      ORDER BY MAX(v.viewed_at) DESC
    `).bind(artifactId).all<{
      email: string;
      name: string | null;
      role: string;
      view_count: number;
      first_viewed_at: string | null;
      last_viewed_at: string | null;
    }>();

    return (result.results || []).map(row => ({
      email: row.email,
      name: row.name,
      role: row.role,
      hasViewed: row.view_count > 0,
      firstViewedAt: row.first_viewed_at,
      lastViewedAt: row.last_viewed_at,
      viewCount: row.view_count,
    }));
  } catch {
    return [];
  }
}
