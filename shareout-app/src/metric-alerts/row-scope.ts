import type { Env } from '../types';
import { JSON_IN, jsonList } from '../sql-in';
import { parseAccessPolicy, resolveViewerScope } from '../data/access-policy';

/**
 * Metric alerts and watches are evaluated over every row of an artifact's store, so their
 * values are only for callers its row-level access policy does not scope: the artifact owner
 * and owner/editor collaborators (the same rule the data API and the metric-watch bell apply).
 */
export const ROW_SCOPED_ERROR =
  'Permission denied: this artifact limits which rows you can see, so its whole-table metrics are not available to you';

/** True when `accessPolicy` filters rows for this viewer. `unscoped`: owner or owner/editor collaborator. */
export function policyScopesViewer(accessPolicy: string | null | undefined, email: string | null, unscoped: boolean): boolean {
  if (unscoped) return false;
  const policy = parseAccessPolicy(accessPolicy);
  return !!policy && !!resolveViewerScope(policy, { email, isOwner: false });
}

/** The subset of `artifactIds` whose row policy scopes `userId`. */
export async function rowScopedArtifacts(env: Env, userId: string, artifactIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(artifactIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const { results } = await env.DB.prepare(
    `SELECT id, owner_id, access_policy FROM artifacts WHERE id IN ${JSON_IN} AND access_policy IS NOT NULL`
  ).bind(jsonList(ids)).all<{ id: string; owner_id: string | null; access_policy: string }>();
  const others = (results || []).filter((a) => a.owner_id !== userId);
  if (!others.length) return new Set();

  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  const email = user?.email ?? null;
  const editorOf = new Set<string>();
  if (email) {
    const { results: rows } = await env.DB.prepare(
      `SELECT artifact_id FROM collaborators
        WHERE artifact_id IN ${JSON_IN} AND role IN ('owner', 'editor') AND email = ?`
    ).bind(jsonList(others.map((a) => a.id)), email).all<{ artifact_id: string }>();
    for (const r of rows || []) editorOf.add(r.artifact_id);
  }
  return new Set(others.filter((a) => policyScopesViewer(a.access_policy, email, editorOf.has(a.id))).map((a) => a.id));
}

export async function isRowRestricted(env: Env, artifactId: string, userId: string): Promise<boolean> {
  return (await rowScopedArtifacts(env, userId, [artifactId])).has(artifactId);
}
