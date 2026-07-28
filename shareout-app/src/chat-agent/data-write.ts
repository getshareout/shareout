import type { Env } from '../types';
import { createMiniDb } from '../data/minidb-client';
import type { DataContext } from '../data/middleware';
import type { ArtifactAccess } from './access';

// Build the DataContext the data-layer handlers expect, for a write the account
// bot makes on the user's behalf. Mirrors what dataMiddleware assembles
// (src/data/middleware.ts), but the identity + row-level scope come from the
// bot's own access gate (resolveArtifactAccessForUser) rather than HTTP auth.
export async function buildBotDataContext(
  env: Env,
  artifactId: string,
  access: ArtifactAccess
): Promise<DataContext | null> {
  const artifact = await env.DB.prepare(
    'SELECT id, name, visibility, auth_method, workspace_id, owner_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{
    id: string;
    name: string;
    visibility: string;
    auth_method: string | null;
    workspace_id: string | null;
    owner_id: string | null;
  }>();
  if (!artifact) return null;

  const workspaceId = artifact.workspace_id ?? '';
  return {
    artifactId,
    workspaceId,
    artifact,
    db: createMiniDb(env, artifactId, workspaceId),
    env,
    origin: null,
    viewerScope: access.viewerScope,
  };
}
