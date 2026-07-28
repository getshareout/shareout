import type { Env } from './types';
import { generateId } from './crypto-utils';
import type { AuthUser } from './api-auth';
import { getVisibilityScope, placeholders } from './account-links';
import { jsonWithApiErrors } from './http/api-error';

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export interface PersonalFolderSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  artifact_count: number;
}

/** Personal folders live outside any workspace (workspace_id IS NULL) and are owned
 *  by the user. They are scoped to the linked-account set so they line up with the
 *  home grid, which spans all linked accounts. */
export async function handleListPersonalFolders(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  const vis = await getVisibilityScope(env, user);
  const idPh = placeholders(vis.userIds.length);

  const results = await env.DB.prepare(`
    SELECT f.id, f.name, f.slug, f.description, f.created_at,
           (SELECT COUNT(*) FROM artifacts WHERE folder_id = f.id AND deleted_at IS NULL) as artifact_count
    FROM folders f
    WHERE f.workspace_id IS NULL AND f.parent_id IS NULL AND f.owner_id IN (${idPh})
    ORDER BY f.name
  `).bind(...vis.userIds).all<PersonalFolderSummary>();

  return json({ folders: results.results || [] });
}

export async function handleCreatePersonalFolder(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  let body: { name: string; slug?: string; description?: string; parent_id?: string; readme?: string };
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

  const vis = await getVisibilityScope(env, user);
  const idPh = placeholders(vis.userIds.length);

  const parentId = body.parent_id?.trim() || null;
  if (parentId) {
    const parent = await env.DB.prepare(
      `SELECT id FROM folders WHERE id = ? AND workspace_id IS NULL AND owner_id IN (${idPh})`
    ).bind(parentId, ...vis.userIds).first();
    if (!parent) return json({ error: 'Parent folder not found', code: 'PARENT_NOT_FOUND' }, 404);
  }

  // Slug must be unique among siblings (same parent), matching the Team Space rule.
  const existing = await env.DB.prepare(
    `SELECT id FROM folders WHERE workspace_id IS NULL AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL)) AND slug = ? AND owner_id IN (${idPh})`
  ).bind(parentId, parentId, slug, ...vis.userIds).first();

  if (existing) {
    return json({ error: 'A folder with that name already exists', code: 'SLUG_TAKEN' }, 409);
  }

  const folderId = generateId('fld');
  await env.DB.prepare(`
    INSERT INTO folders (id, workspace_id, owner_id, name, slug, parent_id, readme, visibility, created_by)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 'inherit', ?)
  `).bind(folderId, user.id, body.name.trim(), slug, parentId, body.readme?.trim() || null, user.id).run();

  return json({
    id: folderId,
    name: body.name.trim(),
    slug,
    description: null,
    artifact_count: 0,
  }, 201);
}

export async function handleUpdatePersonalFolder(
  request: Request,
  env: Env,
  user: AuthUser,
  folderId: string
): Promise<Response> {
  const folder = await ownedFolder(env, user, folderId);
  if (!folder) return json({ error: 'Folder not found', code: 'NOT_FOUND' }, 404);

  let body: { name?: string; slug?: string; description?: string; readme?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.name !== undefined) {
    if (!body.name.trim()) return json({ error: 'name is required', code: 'VALIDATION_ERROR' }, 400);
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
  if (body.slug !== undefined) {
    if (!SLUG_REGEX.test(body.slug)) {
      return json({ error: 'Invalid slug format', code: 'INVALID_SLUG' }, 400);
    }
    const vis = await getVisibilityScope(env, user);
    const idPh = placeholders(vis.userIds.length);
    const existing = await env.DB.prepare(
      `SELECT id FROM folders WHERE workspace_id IS NULL AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL)) AND slug = ? AND id != ? AND owner_id IN (${idPh})`
    ).bind(folder.parent_id, folder.parent_id, body.slug, folderId, ...vis.userIds).first();
    if (existing) return json({ error: 'A folder with that name already exists', code: 'SLUG_TAKEN' }, 409);
    updates.push('slug = ?');
    values.push(body.slug);
  }

  if (updates.length === 0) {
    return json({ error: 'No fields to update', code: 'NO_UPDATES' }, 400);
  }

  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  values.push(folderId);
  await env.DB.prepare(`UPDATE folders SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  return json({ success: true, id: folderId });
}

export async function handleDeletePersonalFolder(
  request: Request,
  env: Env,
  user: AuthUser,
  folderId: string
): Promise<Response> {
  const folder = await ownedFolder(env, user, folderId);
  if (!folder) return json({ error: 'Folder not found', code: 'NOT_FOUND' }, 404);

  // Orphan artifacts back to "no folder" and promote any subfolders to the top level
  // so deleting a folder never deletes its contents (mirrors Team Space delete).
  await env.DB.prepare('UPDATE artifacts SET folder_id = NULL WHERE folder_id = ?')
    .bind(folderId).run();
  await env.DB.prepare('UPDATE folders SET parent_id = NULL WHERE parent_id = ?')
    .bind(folderId).run();

  await env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(folderId).run();
  return json({ success: true, deleted: folderId });
}

export async function handleMovePersonalArtifactToFolder(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  let body: { folder_id: string | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const vis = await getVisibilityScope(env, user);
  const idPh = placeholders(vis.userIds.length);

  const artifact = await env.DB.prepare(
    `SELECT id FROM artifacts WHERE id = ? AND workspace_id IS NULL AND owner_id IN (${idPh})`
  ).bind(artifactId, ...vis.userIds).first();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  if (body.folder_id) {
    const folder = await ownedFolder(env, user, body.folder_id);
    if (!folder) return json({ error: 'Target folder not found', code: 'FOLDER_NOT_FOUND' }, 404);
  }

  await env.DB.prepare('UPDATE artifacts SET folder_id = ? WHERE id = ?')
    .bind(body.folder_id || null, artifactId).run();

  return json({ success: true, artifact_id: artifactId, folder_id: body.folder_id || null });
}

async function ownedFolder(env: Env, user: AuthUser, folderId: string): Promise<{ id: string; parent_id: string | null } | null> {
  const vis = await getVisibilityScope(env, user);
  const idPh = placeholders(vis.userIds.length);
  return env.DB.prepare(
    `SELECT id, parent_id FROM folders WHERE id = ? AND workspace_id IS NULL AND owner_id IN (${idPh})`
  ).bind(folderId, ...vis.userIds).first<{ id: string; parent_id: string | null }>();
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
