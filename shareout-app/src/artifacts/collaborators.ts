/**
 * Artifact collaborators: invite, list, remove, and transfer ownership.
 */
import type { Env, CollaboratorRole } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { requireSharingRole } from './roles';
import { json } from './json-response';
import { invalidateDeploymentCacheById } from '../serve/deployment-cache';

/** Upsert collaborator rows; returns emails that were added or role-updated. */
export async function addCollaboratorEmails(
  env: Env,
  artifactId: string,
  validEmails: string[],
  role: CollaboratorRole,
  addedById: string
): Promise<string[]> {
  const added: string[] = [];
  for (const email of validEmails) {
    const existing = await env.DB.prepare(
      'SELECT id, role FROM collaborators WHERE artifact_id = ? AND email = ?'
    ).bind(artifactId, email).first<{ id: string; role: string }>();

    if (existing) {
      if (existing.role !== role) {
        await env.DB.prepare(
          'UPDATE collaborators SET role = ? WHERE artifact_id = ? AND email = ?'
        ).bind(role, artifactId, email).run();
        added.push(email);
      }
    } else {
      const collabId = generateId('col');
      await env.DB.prepare(
        'INSERT INTO collaborators (id, artifact_id, email, role, added_by) VALUES (?, ?, ?, ?, ?)'
      ).bind(collabId, artifactId, email, role, addedById).run();
      added.push(email);
    }
  }

  if (validEmails.length > 0) {
    // Sharing with a named person needs a sign-in gate ('google' is the historical
    // name for "any ShareOut session", OTP included). Only fill an UNSET gate: an
    // owner who deliberately chose password/credentials keeps it, and collaborators
    // now clear that gate by identity (see serve/access.ts).
    const flip = await env.DB.prepare(
      "UPDATE artifacts SET auth_method = 'google' WHERE id = ? AND (auth_method IS NULL OR auth_method = '')"
    ).bind(artifactId).run();
    // auth_method rides the deployment cache record; drop it when it actually flips.
    if (flip.meta.changes > 0) await invalidateDeploymentCacheById(env, artifactId);
  }

  return added;
}

export async function handleGetCollaborators(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireSharingRole(env, artifactId, user.id, 'viewer');
  if (forbidden) return forbidden;

  const collaborators = await env.DB.prepare(
    'SELECT email, role, added_at FROM collaborators WHERE artifact_id = ? ORDER BY added_at DESC'
  ).bind(artifactId).all<{ email: string; role: string; added_at: string }>();

  return json({
    collaborators: (collaborators.results || []).map(c => ({
      email: c.email,
      role: c.role,
      added_at: c.added_at,
    })),
  });
}

export async function handleAddCollaborators(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id, auth_method FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string; auth_method: string }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireSharingRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;

  let body: { emails: string[]; role?: CollaboratorRole };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (!Array.isArray(body.emails)) {
    return json({ error: 'emails must be an array', code: 'INVALID_EMAILS' }, 400);
  }

  const role: CollaboratorRole = body.role || 'viewer';
  if (!['editor', 'viewer'].includes(role)) {
    return json({ error: 'Invalid role. Must be editor or viewer', code: 'INVALID_ROLE' }, 400);
  }

  const validEmails = body.emails
    .filter(e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .map(e => e.toLowerCase().trim());

  const added = await addCollaboratorEmails(env, artifactId, validEmails, role, user.id);

  const allCollaborators = await env.DB.prepare(
    'SELECT email, role, added_at FROM collaborators WHERE artifact_id = ?'
  ).bind(artifactId).all<{ email: string; role: string; added_at: string }>();

  return json({
    success: true,
    added,
    collaborators: (allCollaborators.results || []).map(c => ({
      email: c.email,
      role: c.role,
      added_at: c.added_at,
    })),
  });
}

export async function handleRemoveCollaborator(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string,
  email: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireSharingRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;

  const normalizedEmail = email.toLowerCase().trim();

  const target = await env.DB.prepare(
    'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(artifactId, normalizedEmail).first<{ role: string }>();

  if (target?.role === 'owner') {
    return json({ error: 'Cannot remove owner', code: 'CANNOT_REMOVE_OWNER' }, 400);
  }

  const result = await env.DB.prepare(
    'DELETE FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(artifactId, normalizedEmail).run();

  const allCollaborators = await env.DB.prepare(
    'SELECT email, role, added_at FROM collaborators WHERE artifact_id = ?'
  ).bind(artifactId).all<{ email: string; role: string; added_at: string }>();

  return json({
    success: true,
    removed: result.meta.changes > 0,
    collaborators: (allCollaborators.results || []).map(c => ({
      email: c.email,
      role: c.role,
      added_at: c.added_at,
    })),
  });
}

// Core ownership transfer: flips artifacts.owner_id, demotes the old owner's
// collaborator row to editor, promotes/inserts the new owner, and busts slug
// caches. Caller is responsible for authorization. Returns null on success or a
// {error,code,status} on a validation failure.
export async function transferArtifactOwnership(
  env: Env,
  artifactId: string,
  currentOwnerId: string,
  newOwnerEmail: string,
  actorId: string
): Promise<{ error: string; code: string; status: number } | null> {
  const newOwner = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(newOwnerEmail).first<{ id: string }>();

  if (!newOwner) {
    return { error: 'User not found', code: 'USER_NOT_FOUND', status: 404 };
  }

  const currentOwner = await env.DB.prepare(
    'SELECT email FROM users WHERE id = ?'
  ).bind(currentOwnerId).first<{ email: string }>();

  await env.DB.prepare(
    'UPDATE artifacts SET owner_id = ? WHERE id = ?'
  ).bind(newOwner.id, artifactId).run();

  // A service/API-created account can have a NULL email; binding undefined throws.
  if (currentOwner?.email) {
    await env.DB.prepare(
      'UPDATE collaborators SET role = ? WHERE artifact_id = ? AND email = ?'
    ).bind('editor', artifactId, currentOwner.email).run();
  }

  const existingCollab = await env.DB.prepare(
    'SELECT id FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(artifactId, newOwnerEmail).first();

  if (existingCollab) {
    await env.DB.prepare(
      'UPDATE collaborators SET role = ? WHERE artifact_id = ? AND email = ?'
    ).bind('owner', artifactId, newOwnerEmail).run();
  } else {
    const collabId = generateId('col');
    await env.DB.prepare(
      'INSERT INTO collaborators (id, artifact_id, email, role, added_by) VALUES (?, ?, ?, ?, ?)'
    ).bind(collabId, artifactId, newOwnerEmail, 'owner', actorId).run();
  }

  if (env.SLUGS) {
    const deployment = await env.DB.prepare(
      'SELECT slug FROM deployments WHERE artifact_id = ? AND channel = ?'
    ).bind(artifactId, 'production').first<{ slug: string }>();
    if (deployment) {
      await env.SLUGS.delete(`deploy:${deployment.slug}`).catch(() => {});
      await env.SLUGS.delete(`art:${deployment.slug}`).catch(() => {});
    }
    await env.SLUGS.delete(`art:${artifactId}`).catch(() => {});
  }

  return null;
}

export async function handleTransferOwnership(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id, owner_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string; owner_id: string }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireSharingRole(env, artifactId, user.id, 'owner');
  if (forbidden) return forbidden;

  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return json({ error: 'Valid email required', code: 'INVALID_EMAIL' }, 400);
  }

  const newOwnerEmail = body.email.toLowerCase().trim();
  const fail = await transferArtifactOwnership(env, artifactId, artifact.owner_id, newOwnerEmail, user.id);
  if (fail) return json({ error: fail.error, code: fail.code }, fail.status);

  return json({ success: true, new_owner: newOwnerEmail });
}
