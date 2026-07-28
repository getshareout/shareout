/**
 * Instance-owner workspace provisioning.
 *
 * The `/admin` portal could read fifteen views and write nothing but feature flags,
 * so the person who owns the instance could not stand up a workspace for a team and
 * hand it over — the only path was to sign in as that person, or edit the repo.
 *
 * These two operations close that: create a workspace owned by someone (who need not
 * have signed in yet), and set anyone's role in any workspace. Both are guarded by
 * `requireSuperAdmin` at the router; neither requires the caller to be a member of
 * the workspace they are acting on, which is the whole point.
 */
import type { Env, WorkspaceRole } from '../types';
import { generateId } from '../crypto-utils';
import { createWorkspaceForUser } from '../workspaces/crud';
import { inviteOrAddMember } from '../workspaces/invite';
import { generateWorkspaceSlug } from '../workspaces/slug';
import { logAudit } from '../audit';

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'member'];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export interface ProvisionResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/**
 * Find or create the user who will own the workspace. Creating one is deliberate:
 * an instance owner should be able to provision "marketing's workspace, owned by
 * ana@" before Ana has ever opened the product. She lands in it on first sign-in.
 */
async function resolveOwner(env: Env, email: string): Promise<{ id: string; email: string }> {
  const existing = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
    .bind(email).first<{ id: string; email: string }>();
  if (existing) return existing;

  const id = generateId('usr');
  await env.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
    .bind(id, email, email.split('@')[0] || 'there').run();
  return { id, email };
}

export async function provisionWorkspace(
  env: Env,
  actor: { id: string; email: string },
  input: { name?: string; slug?: string; description?: string; owner_email?: string },
  executionCtx?: ExecutionContext,
): Promise<ProvisionResult> {
  const name = (input.name || '').trim();
  if (!name) return { ok: false, status: 400, body: { error: 'name is required', code: 'VALIDATION_ERROR' } };

  const ownerEmail = (input.owner_email || '').trim().toLowerCase();
  if (!ownerEmail || !ownerEmail.includes('@')) {
    return { ok: false, status: 400, body: { error: 'owner_email is required', code: 'VALIDATION_ERROR' } };
  }

  const slug = (input.slug || generateWorkspaceSlug(name)).trim();
  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Invalid slug. Use lowercase letters, numbers, and hyphens.', code: 'INVALID_SLUG' },
    };
  }

  const taken = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first();
  if (taken) return { ok: false, status: 409, body: { error: 'Workspace slug already taken', code: 'SLUG_TAKEN' } };

  const owner = await resolveOwner(env, ownerEmail);
  const ws = await createWorkspaceForUser(
    env,
    { id: owner.id, email: owner.email, username: null },
    name,
    { slug, description: input.description || null, executionCtx },
  );

  await logAudit(env, {
    workspaceId: ws.id,
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'workspace.provision',
    targetType: 'workspace',
    targetId: ws.id,
    detail: { owner_email: owner.email, slug: ws.slug },
  });

  return { ok: true, status: 201, body: { ...ws, owner_email: owner.email } };
}

export async function setWorkspaceMemberRole(
  env: Env,
  actor: { id: string; email: string },
  workspaceId: string,
  input: { email?: string; role?: string },
): Promise<ProvisionResult> {
  const email = (input.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { ok: false, status: 400, body: { error: 'email is required', code: 'VALIDATION_ERROR' } };
  }
  const role = input.role;
  if (!isWorkspaceRole(role)) {
    return {
      ok: false,
      status: 400,
      body: { error: `role must be one of ${ROLES.join(', ')}`, code: 'VALIDATION_ERROR' },
    };
  }

  const ws = await env.DB.prepare('SELECT id, name FROM workspaces WHERE id = ?')
    .bind(workspaceId).first<{ id: string; name: string }>();
  if (!ws) return { ok: false, status: 404, body: { error: 'Workspace not found', code: 'NOT_FOUND' } };

  const result = await inviteOrAddMember(env, workspaceId, actor.id, email, role);

  await logAudit(env, {
    workspaceId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'workspace.member_role_set',
    targetType: 'user',
    targetId: email,
    detail: { role, status: result.status },
  });

  return { ok: true, status: 200, body: { ...result, workspace_id: workspaceId, role } };
}
