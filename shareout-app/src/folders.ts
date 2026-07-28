import type { Env, FolderVisibility, Visibility } from './types';
import { generateId } from './crypto-utils';
import { normalizeVisibility } from './visibility-config';
import type { AuthUser } from './api-auth';
import { getInternalWorkspaceRole } from './workspaces';
import { jsonWithApiErrors } from './http/api-error';

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export interface FolderSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: FolderVisibility;
  parent_id: string | null;
  artifact_count: number;
  subfolder_count: number;
  created_at: string;
}

export async function handleListFolders(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  const url = new URL(request.url);
  const parentId = url.searchParams.get('parent_id') || null;
  const all = url.searchParams.get('all'); // full tree (every depth) for hierarchical pickers

  const scope = all ? '' : ` AND ${parentId ? 'f.parent_id = ?' : 'f.parent_id IS NULL'}`;
  const binds = all ? [workspaceId] : (parentId ? [workspaceId, parentId] : [workspaceId]);
  const results = await env.DB.prepare(`
    SELECT
      f.id, f.name, f.slug, f.description, f.visibility, f.parent_id, f.created_at,
      (SELECT COUNT(*) FROM artifacts WHERE folder_id = f.id AND deleted_at IS NULL) as artifact_count,
      (SELECT COUNT(*) FROM folders WHERE parent_id = f.id) as subfolder_count
    FROM folders f
    WHERE f.workspace_id = ?${scope}
    ORDER BY f.name
  `).bind(...binds).all<FolderSummary>();

  return json({ folders: results.results || [] });
}

export async function handleCreateFolder(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  // Team Space folders are the workspace's shared structure — only admins/owners
  // shape it. Members add and remove their own artifacts within those folders.
  if (role === 'member') {
    return json({ error: 'Only workspace admins can create Team Space folders', code: 'ADMIN_REQUIRED' }, 403);
  }

  let body: {
    name: string;
    slug?: string;
    description?: string;
    parent_id?: string;
    readme?: string;
    visibility?: FolderVisibility;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (!body.name?.trim()) {
    return json({ error: 'name is required', code: 'VALIDATION_ERROR' }, 400);
  }

  const slug = body.slug || generateFolderSlug(body.name);
  if (!SLUG_REGEX.test(slug)) {
    return json({ error: 'Invalid slug format', code: 'INVALID_SLUG' }, 400);
  }

  if (body.parent_id) {
    const parent = await env.DB.prepare(
      'SELECT id FROM folders WHERE id = ? AND workspace_id = ?'
    ).bind(body.parent_id, workspaceId).first();
    if (!parent) {
      return json({ error: 'Parent folder not found', code: 'PARENT_NOT_FOUND' }, 404);
    }
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM folders WHERE workspace_id = ? AND slug = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))'
  ).bind(workspaceId, slug, body.parent_id || null, body.parent_id || null).first();

  if (existing) {
    return json({ error: 'Folder slug already exists at this level', code: 'SLUG_TAKEN' }, 409);
  }

  const folderId = generateId('fld');
  const visibility: FolderVisibility = body.visibility || 'inherit';

  await env.DB.prepare(`
    INSERT INTO folders (id, workspace_id, name, slug, description, parent_id, readme, visibility, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    folderId,
    workspaceId,
    body.name.trim(),
    slug,
    body.description || null,
    body.parent_id || null,
    body.readme?.trim() || null,
    visibility,
    user.id
  ).run();

  return handleGetFolder(request, env, user, workspaceId, folderId);
}

export async function handleGetFolder(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  folderId: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  const folder = await env.DB.prepare(`
    SELECT
      f.id, f.name, f.slug, f.description, f.readme, f.visibility, f.parent_id, f.created_at, f.updated_at,
      f.workspace_id, w.slug as workspace_slug,
      (SELECT COUNT(*) FROM artifacts WHERE folder_id = f.id AND deleted_at IS NULL) as artifact_count,
      (SELECT COUNT(*) FROM folders WHERE parent_id = f.id) as subfolder_count
    FROM folders f
    JOIN workspaces w ON w.id = f.workspace_id
    WHERE f.id = ? AND f.workspace_id = ?
  `).bind(folderId, workspaceId).first<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    readme: string | null;
    visibility: FolderVisibility;
    parent_id: string | null;
    created_at: string;
    updated_at: string | null;
    workspace_id: string;
    workspace_slug: string;
    artifact_count: number;
    subfolder_count: number;
  }>();

  if (!folder) {
    return json({ error: 'Folder not found', code: 'NOT_FOUND' }, 404);
  }

  const path = await buildFolderPath(env, folderId);
  const effectiveVisibility = await getEffectiveVisibility(env, folderId);

  return json({
    ...folder,
    path,
    effective_visibility: effectiveVisibility,
  });
}

export async function handleGetFolderByPath(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  folderPath: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  const folderId = await resolveFolderPath(env, workspaceId, folderPath);
  if (!folderId) {
    return json({ error: 'Folder not found', code: 'NOT_FOUND' }, 404);
  }

  return handleGetFolder(request, env, user, workspaceId, folderId);
}

export async function handleUpdateFolder(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  folderId: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  const folder = await env.DB.prepare(
    'SELECT id FROM folders WHERE id = ? AND workspace_id = ?'
  ).bind(folderId, workspaceId).first();

  if (!folder) {
    return json({ error: 'Folder not found', code: 'NOT_FOUND' }, 404);
  }

  let body: {
    name?: string;
    slug?: string;
    description?: string;
    readme?: string;
    visibility?: FolderVisibility;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name.trim());
  }

  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description || null);
  }

  if (body.readme !== undefined) {
    updates.push('readme = ?');
    values.push(body.readme.trim() || null);
  }

  if (body.visibility !== undefined) {
    // Accept legacy 'unlisted' and fold it into 'public' (retired 2026-07).
    const requested = normalizeVisibility(body.visibility);
    if (!['inherit', 'public', 'workspace', 'private'].includes(requested)) {
      return json({ error: 'Invalid visibility', code: 'INVALID_VISIBILITY' }, 400);
    }
    updates.push('visibility = ?');
    values.push(requested);
  }

  if (body.slug !== undefined) {
    if (!SLUG_REGEX.test(body.slug)) {
      return json({ error: 'Invalid slug format', code: 'INVALID_SLUG' }, 400);
    }
    const currentFolder = await env.DB.prepare(
      'SELECT parent_id FROM folders WHERE id = ?'
    ).bind(folderId).first<{ parent_id: string | null }>();

    const existing = await env.DB.prepare(
      'SELECT id FROM folders WHERE workspace_id = ? AND slug = ? AND id != ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))'
    ).bind(workspaceId, body.slug, folderId, currentFolder?.parent_id || null, currentFolder?.parent_id || null).first();

    if (existing) {
      return json({ error: 'Folder slug already exists at this level', code: 'SLUG_TAKEN' }, 409);
    }
    updates.push('slug = ?');
    values.push(body.slug);
  }

  if (updates.length === 0) {
    return json({ error: 'No fields to update', code: 'NO_UPDATES' }, 400);
  }

  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  values.push(folderId);

  await env.DB.prepare(
    `UPDATE folders SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return handleGetFolder(request, env, user, workspaceId, folderId);
}

export async function handleDeleteFolder(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  folderId: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role || role === 'member') {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const folder = await env.DB.prepare(
    'SELECT id FROM folders WHERE id = ? AND workspace_id = ?'
  ).bind(folderId, workspaceId).first();

  if (!folder) {
    return json({ error: 'Folder not found', code: 'NOT_FOUND' }, 404);
  }

  // Orphan artifacts back to "no folder" and promote any subfolders to the top
  // level so deleting a folder never deletes its contents.
  await env.DB.prepare('UPDATE artifacts SET folder_id = NULL WHERE folder_id = ?')
    .bind(folderId).run();
  await env.DB.prepare('UPDATE folders SET parent_id = NULL WHERE parent_id = ?')
    .bind(folderId).run();

  await env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(folderId).run();

  return json({ success: true, deleted: folderId });
}

export async function handleMoveArtifactToFolder(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  artifactId: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  let body: { folder_id: string | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const artifact = await env.DB.prepare(
    'SELECT id FROM artifacts WHERE id = ? AND workspace_id = ?'
  ).bind(artifactId, workspaceId).first();

  if (!artifact) {
    return json({ error: 'Artifact not found in workspace', code: 'NOT_FOUND' }, 404);
  }

  if (body.folder_id) {
    const folder = await env.DB.prepare(
      'SELECT id FROM folders WHERE id = ? AND workspace_id = ?'
    ).bind(body.folder_id, workspaceId).first();

    if (!folder) {
      return json({ error: 'Target folder not found', code: 'FOLDER_NOT_FOUND' }, 404);
    }
  }

  await env.DB.prepare(
    'UPDATE artifacts SET folder_id = ? WHERE id = ?'
  ).bind(body.folder_id, artifactId).run();

  return json({ success: true, artifact_id: artifactId, folder_id: body.folder_id });
}

export async function resolveFolderPath(
  env: Env,
  workspaceId: string,
  folderPath: string
): Promise<string | null> {
  const segments = folderPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  let parentId: string | null = null;
  let folderId: string | null = null;

  for (const slug of segments) {
    const folderResult: { id: string } | null = await env.DB.prepare(
      'SELECT id FROM folders WHERE workspace_id = ? AND slug = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))'
    ).bind(workspaceId, slug, parentId, parentId).first();

    if (!folderResult) return null;
    folderId = folderResult.id;
    parentId = folderResult.id;
  }

  return folderId;
}

async function buildFolderPath(env: Env, folderId: string): Promise<string> {
  const segments: string[] = [];
  let currentId: string | null = folderId;

  while (currentId) {
    const folderResult: { slug: string; parent_id: string | null } | null = await env.DB.prepare(
      'SELECT slug, parent_id FROM folders WHERE id = ?'
    ).bind(currentId).first();

    if (!folderResult) break;
    segments.unshift(folderResult.slug);
    currentId = folderResult.parent_id;
  }

  return segments.join('/');
}

async function getEffectiveVisibility(env: Env, folderId: string): Promise<Visibility> {
  let currentId: string | null = folderId;

  while (currentId) {
    const folderResult: { visibility: FolderVisibility; parent_id: string | null } | null = await env.DB.prepare(
      'SELECT visibility, parent_id FROM folders WHERE id = ?'
    ).bind(currentId).first();

    if (!folderResult) break;
    if (folderResult.visibility !== 'inherit') {
      return folderResult.visibility as Visibility;
    }
    currentId = folderResult.parent_id;
  }

  return 'public';
}

function generateFolderSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'folder';
}

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}
