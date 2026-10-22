import { getInternalWorkspaceRole } from '../../workspaces/roles';
import type { CrewTool } from '../types';

const MAX = 200;

// List this workspace's artifacts the crew owner can open (owner, collaborator, or
// workspace/public visibility for an internal member), newest change first.
export const workspaceArtifactsTool: CrewTool = {
  name: 'workspace_artifacts',
  mode: 'read',
  description:
    "List artifacts in this crew's workspace that its owner can open: id, name, slug, visibility, type, created_at, updated_at, current_version. Newest change first. Use name_contains to find a tool/page by name, then workspace_data_read to read its data.",
  input_schema: {
    type: 'object',
    properties: {
      name_contains: { type: 'string', description: 'Case-insensitive substring of the artifact name.' },
      updated_since: { type: 'string', description: 'ISO date; only artifacts changed on/after it.' },
      limit: { type: 'number', description: `Max rows (default 100, max ${MAX}).` },
      offset: { type: 'number', description: 'Rows to skip.' },
    },
  },
  async execute(ctx, input) {
    const { env } = ctx.data;
    const { ownerId, workspaceId } = ctx.principal;
    if (!workspaceId) return { error: 'This crew is not in a workspace.' };
    const internal = await getInternalWorkspaceRole(env, workspaceId, ownerId);
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(ownerId).first<{ email: string }>();
    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), MAX);
    const offset = Math.max(Number(input.offset) || 0, 0);
    const name = typeof input.name_contains === 'string' ? input.name_contains.trim().toLowerCase() : '';
    const since = typeof input.updated_since === 'string' ? input.updated_since : '';
    const rows = await env.DB.prepare(`
      SELECT a.id, a.name, a.slug, a.visibility, a.artifact_type, a.created_at,
        COALESCE(d.updated_at, a.created_at) AS updated_at,
        COALESCE((SELECT version_no FROM versions WHERE id = d.version_id), (SELECT MAX(version_no) FROM versions WHERE artifact_id = a.id)) AS current_version
      FROM artifacts a
      LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      WHERE a.workspace_id = ? AND a.deleted_at IS NULL
        AND (a.owner_id = ? OR (? = 1 AND a.visibility IN ('workspace', 'public'))
             OR EXISTS (SELECT 1 FROM collaborators c WHERE c.artifact_id = a.id AND c.email = ?))
        AND (? = '' OR lower(a.name) LIKE '%' || ? || '%')
        AND (? = '' OR COALESCE(d.updated_at, a.created_at) >= ?)
      ORDER BY COALESCE(d.updated_at, a.created_at) DESC
      LIMIT ? OFFSET ?
    `).bind(workspaceId, ownerId, internal ? 1 : 0, user?.email ?? '', name, name, since, since, limit, offset).all();
    return { artifacts: rows.results, count: rows.results.length };
  },
};
