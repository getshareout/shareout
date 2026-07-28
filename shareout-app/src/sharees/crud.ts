// External-sharing spine (work/030) — Sharee org CRUD.
// A Sharee is an external org a workspace shares outward to. UI surfaces them by
// `type` ("Clients", "Partners"), never the internal word "Sharee".
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { json } from '../workspaces/json-response';
import { requireWorkspaceRole } from '../workspaces';
import { generateId } from '../crypto-utils';
import { logAudit } from '../audit';
import { requireExternalSharing } from './guard';

interface ShareeRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  type: string;
  properties: string | null;
  branding: string | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'sharee';
}

async function uniqueSlug(env: Env, workspaceId: string, base: string): Promise<string> {
  let slug = base;
  for (let i = 0; i < 50; i++) {
    const clash = await env.DB.prepare(
      'SELECT 1 FROM sharees WHERE workspace_id = ? AND slug = ?'
    ).bind(workspaceId, slug).first();
    if (!clash) return slug;
    slug = `${base}-${i + 2}`;
  }
  return `${base}-${generateId('s').slice(0, 6)}`;
}

function shapeSharee(r: ShareeRow & { member_count?: number }) {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    slug: r.slug,
    type: r.type,
    properties: r.properties ? JSON.parse(r.properties) : null,
    branding: r.branding ? JSON.parse(r.branding) : null,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
    member_count: r.member_count ?? 0,
  };
}

// Listing is admin-only but NOT entitlement-gated, so a lapsed workspace can still
// see (and wind down) its existing external orgs.
export async function handleListSharees(
  request: Request, env: Env, user: AuthUser, workspaceId: string,
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  const { results } = await env.DB.prepare(`
    SELECT s.*, (
      SELECT COUNT(*) FROM sharee_members sm
       WHERE sm.sharee_id = s.id AND sm.status != 'removed'
    ) AS member_count
    FROM sharees s
    WHERE s.workspace_id = ?
    ORDER BY s.created_at DESC
  `).bind(workspaceId).all<ShareeRow & { member_count: number }>();

  return json({ sharees: (results || []).map(shapeSharee) });
}

export async function handleCreateSharee(
  request: Request, env: Env, user: AuthUser, workspaceId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  let body: { name?: string; type?: string; properties?: unknown; slug?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const name = (body.name || '').trim();
  if (!name) return json({ error: 'name is required', code: 'VALIDATION_ERROR' }, 400);

  const slug = await uniqueSlug(env, workspaceId, slugify(body.slug || name));
  const id = generateId('shr');
  await env.DB.prepare(`
    INSERT INTO sharees (id, workspace_id, name, slug, type, properties, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, workspaceId, name, slug, (body.type || 'client').trim(),
    body.properties ? JSON.stringify(body.properties) : null, user.id,
  ).run();

  await logAudit(env, { workspaceId, actorId: user.id, action: 'sharee.create', targetType: 'sharee', targetId: id }).catch(() => {});

  const row = await env.DB.prepare('SELECT * FROM sharees WHERE id = ?').bind(id).first<ShareeRow>();
  return json({ sharee: shapeSharee(row!) }, 201);
}

async function loadSharee(env: Env, workspaceId: string, shareeId: string): Promise<ShareeRow | null> {
  return env.DB.prepare('SELECT * FROM sharees WHERE id = ? AND workspace_id = ?')
    .bind(shareeId, workspaceId).first<ShareeRow>();
}

export async function handleGetSharee(
  request: Request, env: Env, user: AuthUser, workspaceId: string, shareeId: string,
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;
  const row = await loadSharee(env, workspaceId, shareeId);
  if (!row) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  return json({ sharee: shapeSharee(row) });
}

export async function handleUpdateSharee(
  request: Request, env: Env, user: AuthUser, workspaceId: string, shareeId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;
  const row = await loadSharee(env, workspaceId, shareeId);
  if (!row) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  let body: { name?: string; type?: string; properties?: unknown; branding?: unknown };
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  await env.DB.prepare(`
    UPDATE sharees SET
      name = ?, type = ?, properties = ?, branding = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ? AND workspace_id = ?
  `).bind(
    (body.name ?? row.name).trim(),
    (body.type ?? row.type).trim(),
    body.properties !== undefined ? JSON.stringify(body.properties) : row.properties,
    body.branding !== undefined ? JSON.stringify(body.branding) : row.branding,
    shareeId, workspaceId,
  ).run();

  const updated = await loadSharee(env, workspaceId, shareeId);
  return json({ sharee: shapeSharee(updated!) });
}

// Delete cascades to sharee_members (FK ON DELETE CASCADE). Grants keyed by
// subject_id='sharee' are orphaned rows that resolve to nothing; we hard-delete them
// too so a stale grant can never resurrect access if an id is reused.
export async function handleDeleteSharee(
  request: Request, env: Env, user: AuthUser, workspaceId: string, shareeId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;
  const row = await loadSharee(env, workspaceId, shareeId);
  if (!row) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  await env.DB.prepare(
    "DELETE FROM grants WHERE workspace_id = ? AND subject_type = 'sharee' AND subject_id = ?"
  ).bind(workspaceId, shareeId).run();
  // Client context notes have no FK cascade (added via ALTER) — clean them explicitly.
  await env.DB.prepare(
    "DELETE FROM workspace_files WHERE workspace_id = ? AND namespace = 'context' AND scope_id = ?"
  ).bind(workspaceId, shareeId).run();
  await env.DB.prepare('DELETE FROM sharees WHERE id = ? AND workspace_id = ?')
    .bind(shareeId, workspaceId).run();

  const { invalidateGrants } = await import('../access/can-access');
  await invalidateGrants(env, workspaceId);
  await logAudit(env, { workspaceId, actorId: user.id, action: 'sharee.delete', targetType: 'sharee', targetId: shareeId }).catch(() => {});
  return json({ success: true });
}
