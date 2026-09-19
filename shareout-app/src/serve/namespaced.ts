import type { Env } from '../types';
import type { ArtifactInfo } from './types';
import { handleServe } from './handle-serve';

export async function handleServeNamespaced(
  request: Request,
  env: Env,
  workspaceSlug: string,
  folderPath: string,
  artifactSlug: string,
  assetPath: string,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT d.version_id, v.entrypoint, v.artifact_id, a.name as artifact_name,
           a.visibility, a.auth_method, a.owner_id, a.paused, d.slug as deploy_slug,
           w.slug as workspace_slug
    FROM artifacts a
    JOIN workspaces w ON w.id = a.workspace_id
    LEFT JOIN folders f ON f.id = a.folder_id
    JOIN versions v ON v.artifact_id = a.id
    JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE w.slug = ?
      AND a.display_slug = ?
      AND d.version_id = v.id
    ORDER BY v.version_no DESC
    LIMIT 1
  `).bind(workspaceSlug, artifactSlug).first<ArtifactInfo & { deploy_slug: string; workspace_slug: string }>();

  if (!result) {
    return new Response('Not Found', { status: 404 });
  }

  if (folderPath) {
    const folderMatch = await verifyFolderPath(env, result.artifact_id, folderPath);
    if (!folderMatch) {
      return new Response('Not Found', { status: 404 });
    }
  }

  return handleServe(request, env, result.deploy_slug, assetPath, { executionCtx });
}

// The artifact's folder ancestry, root first, in one query (was one query per level).
export async function verifyFolderPath(env: Env, artifactId: string, expectedPath: string): Promise<boolean> {
  const { results } = await env.DB.prepare(`
    WITH RECURSIVE chain(slug, parent_id, depth) AS (
      SELECT f.slug, f.parent_id, 0 FROM artifacts a JOIN folders f ON f.id = a.folder_id WHERE a.id = ?
      UNION ALL
      SELECT f.slug, f.parent_id, c.depth + 1 FROM folders f JOIN chain c ON f.id = c.parent_id
       WHERE c.depth < 64
    )
    SELECT slug FROM chain ORDER BY depth DESC
  `).bind(artifactId).all<{ slug: string }>();

  return (results || []).map((f) => f.slug).join('/') === expectedPath;
}
