import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { getInternalWorkspaceRole } from '../../workspaces';

// GET /v1/workspaces/{id}/shared-tables — list tables shared into this workspace.
// Any member can view the catalog (they may use it); the data itself stays in each
// owning artifact's store (migration 0067 / so.workspace.table).
export async function handleListWorkspaceSharedTables(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const viewerRole = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!viewerRole) {
    return new Response(JSON.stringify({ error: 'Forbidden', code: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { results } = await env.DB.prepare(`
    SELECT t.shared_name, t.source_table_name, t.access, t.owner_artifact_id,
           t.created_at, a.name AS owner_name, a.slug AS owner_slug
      FROM workspace_shared_tables t
      LEFT JOIN artifacts a ON a.id = t.owner_artifact_id
     WHERE t.workspace_id = ?
     ORDER BY t.shared_name ASC
  `).bind(workspaceId).all<{
    shared_name: string;
    source_table_name: string;
    access: string;
    owner_artifact_id: string;
    created_at: string;
    owner_name: string | null;
    owner_slug: string | null;
  }>();

  const sharedTables = (results ?? []).map((r) => ({
    sharedName: r.shared_name,
    sourceTable: r.source_table_name,
    access: r.access,
    ownerArtifactId: r.owner_artifact_id,
    ownerName: r.owner_name,
    ownerSlug: r.owner_slug,
    createdAt: r.created_at,
  }));

  return new Response(JSON.stringify({ viewerRole, sharedTables }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
