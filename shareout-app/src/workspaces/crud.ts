import type { Env, WorkspaceRole } from '../types';
import { generateId } from '../crypto-utils';
import { getLinkedUserIds, placeholders } from '../account-links';
import type { AuthUser } from '../api-auth';
import { json } from './json-response';
import { invalidateWorkspaceRole, requireWorkspaceRole } from './roles';
import { generateWorkspaceSlug, SLUG_REGEX } from './slug';
import { handleGetWorkspace } from './read';
import { scheduleSeedStarterKit } from '../starter-kit';

export async function handleListWorkspaces(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const userIds = await getLinkedUserIds(env, user.id);
  const idPh = placeholders(userIds.length);

  const results = await env.DB.prepare(`
    SELECT
      w.id, w.name, w.slug, w.description, w.created_at,
      MAX(CASE wm.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END) as role_rank,
      (SELECT COUNT(*) FROM artifacts WHERE workspace_id = w.id) as artifact_count,
      (SELECT COUNT(*) FROM folders WHERE workspace_id = w.id) as folder_count
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id IN (${idPh})
    GROUP BY w.id
    ORDER BY w.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...userIds, limit, offset).all<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    created_at: string;
    role_rank: number;
    artifact_count: number;
    folder_count: number;
  }>();

  const workspaces = (results.results || []).map(({ role_rank, ...w }) => ({
    ...w,
    role: (role_rank >= 3 ? 'owner' : role_rank >= 2 ? 'admin' : 'member') as WorkspaceRole,
  }));

  const countResult = await env.DB.prepare(`
    SELECT COUNT(DISTINCT workspace_id) as total FROM workspace_members WHERE user_id IN (${idPh})
  `).bind(...userIds).first<{ total: number }>();

  return json({
    workspaces,
    total: countResult?.total || 0,
    limit,
    offset,
  });
}

// Core workspace creation: the invariant-bearing writes (workspace row + owner
// membership + role-cache invalidation + starter-kit seed) that every creation path
// must go through. Callers own slug policy: pass `slug` when it's already validated
// (handler rejects collisions); omit it to auto-generate a guaranteed-unique slug.
export async function createWorkspaceForUser(
  env: Env,
  user: AuthUser,
  name: string,
  opts?: { slug?: string; description?: string | null; executionCtx?: ExecutionContext }
): Promise<{ id: string; name: string; slug: string; description: string | null }> {
  const trimmed = name.trim();
  let slug = opts?.slug ?? generateWorkspaceSlug(trimmed);
  if (!opts?.slug) {
    while (await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first()) {
      slug = `${generateWorkspaceSlug(trimmed)}-${generateId('w').slice(2, 6)}`;
    }
  }

  const workspaceId = generateId('wsp');
  const memberId = generateId('wsm');
  const description = opts?.description ?? null;

  await env.DB.prepare(`
    INSERT INTO workspaces (id, name, slug, description, owner_id)
    VALUES (?, ?, ?, ?, ?)
  `).bind(workspaceId, trimmed, slug, description, user.id).run();

  await env.DB.prepare(`
    INSERT INTO workspace_members (id, workspace_id, user_id, role)
    VALUES (?, ?, ?, 'owner')
  `).bind(memberId, workspaceId, user.id).run();

  await invalidateWorkspaceRole(env, workspaceId, user.id);

  // A fresh workspace opens populated, not empty: seed the personal kit plus the
  // team-only examples into it, in the background.
  scheduleSeedStarterKit(env, user, { workspaceId, tier: 'team' }, opts?.executionCtx);

  return { id: workspaceId, name: trimmed, slug, description };
}

export async function handleCreateWorkspace(
  request: Request,
  env: Env,
  user: AuthUser,
  executionCtx?: ExecutionContext
): Promise<Response> {
  let body: { name: string; slug?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (!body.name?.trim()) {
    return json({ error: 'name is required', code: 'VALIDATION_ERROR' }, 400);
  }

  const slug = body.slug || generateWorkspaceSlug(body.name);
  if (!SLUG_REGEX.test(slug)) {
    return json({ error: 'Invalid slug. Use lowercase letters, numbers, and hyphens, starting and ending with a letter or number.', code: 'INVALID_SLUG' }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM workspaces WHERE slug = ?'
  ).bind(slug).first();
  if (existing) {
    return json({ error: 'Workspace slug already taken', code: 'SLUG_TAKEN' }, 409);
  }

  const ws = await createWorkspaceForUser(env, user, body.name, {
    slug,
    description: body.description || null,
    executionCtx,
  });

  return json({ ...ws, role: 'owner' }, 201);
}

export async function handleUpdateWorkspace(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  let body: { name?: string; description?: string; slug?: string };
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

  if (body.slug !== undefined) {
    if (!SLUG_REGEX.test(body.slug)) {
      return json({ error: 'Invalid slug. Use lowercase letters, numbers, and hyphens, starting and ending with a letter or number.', code: 'INVALID_SLUG' }, 400);
    }
    const existing = await env.DB.prepare(
      'SELECT id FROM workspaces WHERE slug = ? AND id != ?'
    ).bind(body.slug, workspaceId).first();
    if (existing) {
      return json({ error: 'Workspace slug already taken', code: 'SLUG_TAKEN' }, 409);
    }
    updates.push('slug = ?');
    values.push(body.slug);
  }

  if (updates.length === 0) {
    return json({ error: 'No fields to update', code: 'NO_UPDATES' }, 400);
  }

  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  values.push(workspaceId);

  await env.DB.prepare(
    `UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return handleGetWorkspace(request, env, user, workspaceId);
}

export async function handleDeleteWorkspace(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'owner');
  if (forbidden) return forbidden;

  const artifactCount = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM artifacts WHERE workspace_id = ?'
  ).bind(workspaceId).first<{ count: number }>();

  if (artifactCount && artifactCount.count > 0) {
    return json({
      error: 'Workspace contains artifacts. Move or delete them first.',
      code: 'WORKSPACE_NOT_EMPTY',
    }, 400);
  }

  await env.DB.prepare('DELETE FROM folders WHERE workspace_id = ?').bind(workspaceId).run();
  await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').bind(workspaceId).run();
  await env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(workspaceId).run();

  return json({ success: true, deleted: workspaceId });
}
