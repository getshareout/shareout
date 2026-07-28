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

async function verifyFolderPath(env: Env, artifactId: string, expectedPath: string): Promise<boolean> {
  const artifact = await env.DB.prepare(
    'SELECT folder_id, workspace_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ folder_id: string | null; workspace_id: string }>();

  if (!artifact) return false;
  if (!artifact.folder_id && !expectedPath) return true;
  if (!artifact.folder_id && expectedPath) return false;

  const segments: string[] = [];
  let currentId: string | null = artifact.folder_id;

  while (currentId) {
    const folder = await env.DB.prepare(
      'SELECT slug, parent_id FROM folders WHERE id = ?'
    ).bind(currentId).first<{ slug: string; parent_id: string | null }>();

    if (!folder) break;
    segments.unshift(folder.slug);
    currentId = folder.parent_id;
  }

  return segments.join('/') === expectedPath;
}