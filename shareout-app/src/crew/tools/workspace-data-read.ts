import { canViewArtifact } from '../../data/middleware';
import { createMiniDb } from '../../data/minidb-client';
import { jsonGetTool } from './json-get';
import { tableQueryTool } from './table-query';
import type { CrewTool } from '../types';

// Read another artifact's JSON key or table in the crew's own workspace, in-process
// (no HTTP self-fetch). Same access rule as opening the artifact as the crew owner.
export const workspaceDataReadTool: CrewTool = {
  name: 'workspace_data_read',
  mode: 'read',
  description:
    "Read data from ANOTHER artifact in this workspace (one the crew owner can open). Pass artifact_id (see workspace_artifacts) and either json_key (read a JSON key) or table (query rows; optional filter/sort/limit/select like table_query). Read-only.",
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      json_key: { type: 'string', description: 'JSON store key to read.' },
      table: { type: 'string', description: 'Table to query.' },
      filter: { type: 'object' },
      sort: { type: 'object' },
      limit: { type: 'number' },
      select: { type: 'array', items: { type: 'string' } },
    },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const { env } = ctx.data;
    const { ownerId, workspaceId } = ctx.principal;
    const id = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    if (!id) return { error: 'Missing required field "artifact_id".' };
    if (!input.json_key && !input.table) return { error: 'Pass json_key or table.' };
    const art = await env.DB.prepare(
      'SELECT id, name, visibility, auth_method, workspace_id, owner_id FROM artifacts WHERE id = ? AND deleted_at IS NULL'
    ).bind(id).first<{ id: string; name: string; visibility: string; auth_method: string | null; workspace_id: string | null; owner_id: string | null }>();
    // Same message for missing and cross-workspace: don't reveal other workspaces' ids.
    if (!art || !workspaceId || art.workspace_id !== workspaceId) return { error: 'Artifact not found in this workspace.' };
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(ownerId).first<{ email: string }>();
    if (!(await canViewArtifact(env, art, ownerId, user?.email ?? null))) return { error: 'Artifact not found in this workspace.' };

    const target = {
      ...ctx,
      data: { ...ctx.data, artifactId: id, artifact: art, db: createMiniDb(env, id, workspaceId), viewerScope: null },
    };
    const out = input.json_key
      ? await jsonGetTool.execute(target, { key: input.json_key })
      : await tableQueryTool.execute(target, input);
    return { artifact: { id: art.id, name: art.name }, ...(out as object) };
  },
};
