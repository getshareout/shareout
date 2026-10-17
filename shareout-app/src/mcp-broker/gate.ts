/**
 * Who may use a page's MCP declaration: a signed-in internal member of the page's
 * workspace who can view the page, on a members-only (non-public) workspace page
 * whose live version declares MCP connections. Guests and public links never qualify.
 */
import type { Env } from '../types';
import { canViewArtifact } from '../data/middleware';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { normalizeVisibility } from '../visibility-config';
import { mcpCapabilityFromManifest, mcpCapabilityHash, productionManifestJson, type McpCapability } from './capabilities';

export interface McpPageContext {
  artifactId: string;
  workspaceId: string;
  capability: McpCapability;
  capabilityHash: string;
}

export type McpGateFailure = 'not_found' | 'not_available' | 'not_allowed';

export async function resolveMcpPage(
  env: Env,
  artifactId: string,
  user: { id: string; email: string | null },
): Promise<McpPageContext | McpGateFailure> {
  const artifact = await env.DB.prepare(
    'SELECT id, visibility, workspace_id, owner_id FROM artifacts WHERE id = ? AND deleted_at IS NULL',
  ).bind(artifactId).first<{ id: string; visibility: string; workspace_id: string | null; owner_id: string | null }>();
  if (!artifact) return 'not_found';
  if (!artifact.workspace_id || normalizeVisibility(artifact.visibility) === 'public') return 'not_available';

  const capability = mcpCapabilityFromManifest(await productionManifestJson(env, artifactId));
  if (!capability) return 'not_available';

  if (!(await getInternalWorkspaceRole(env, artifact.workspace_id, user.id))) return 'not_allowed';
  if (!(await canViewArtifact(env, artifact, user.id, user.email))) return 'not_allowed';

  return { artifactId, workspaceId: artifact.workspace_id, capability, capabilityHash: await mcpCapabilityHash(capability) };
}
