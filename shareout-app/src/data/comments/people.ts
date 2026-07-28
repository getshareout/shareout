import { successResponse, errorResponse, type DataContext } from '../middleware';
import type { CommentPerson, PersonRow } from './types';
import { getSession } from './auth';

/** The artifact owner as a person row — they are not in `collaborators` by default. */
async function ownerRow(ctx: DataContext): Promise<PersonRow | null> {
  const ownerId = ctx.artifact?.owner_id;
  if (!ownerId) return null;
  const u = await ctx.env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?')
    .bind(ownerId).first<{ id: string; email: string | null; name: string | null }>();
  if (!u?.email) return null;
  return { user_id: u.id, email: u.email, name: u.name, role: 'owner' };
}

/** Artifact owner + workspace members + artifact collaborators, deduped by email. */
export async function listPeople(ctx: DataContext): Promise<CommentPerson[]> {
  let rows: PersonRow[] = [];

  if (ctx.workspaceId) {
    const result = await ctx.env.DB.prepare(`
      SELECT u.id AS user_id, u.email AS email, u.name AS name, wm.role AS role
        FROM workspace_members wm
        JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ?1
      UNION
      SELECT u.id AS user_id, c.email AS email, u.name AS name, c.role AS role
        FROM collaborators c
        LEFT JOIN users u ON u.email = c.email
       WHERE c.artifact_id = ?2
      LIMIT 200
    `).bind(ctx.workspaceId, ctx.artifactId).all<PersonRow>();
    rows = result.results;
  } else {
    const result = await ctx.env.DB.prepare(`
      SELECT u.id AS user_id, c.email AS email, u.name AS name, c.role AS role
        FROM collaborators c
        LEFT JOIN users u ON u.email = c.email
       WHERE c.artifact_id = ?1
      LIMIT 200
    `).bind(ctx.artifactId).all<PersonRow>();
    rows = result.results;
  }

  const owner = await ownerRow(ctx);
  const seen = new Set<string>();
  return (owner ? [owner, ...rows] : rows)
    .filter((r) => {
      if (!r.email) return false;
      const key = r.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({ id: r.user_id, email: r.email, name: r.name, role: r.role }));
}

/** True when `email` belongs to someone on this artifact (owner, member, collaborator). */
export async function isPersonOnArtifact(ctx: DataContext, email: string | null): Promise<boolean> {
  const target = (email || '').trim().toLowerCase();
  if (!target) return false;
  const people = await listPeople(ctx);
  return people.some((p) => p.email.toLowerCase() === target);
}

/**
 * Resolve an assignee email against the artifact's people set.
 * Returns null when the email is not a workspace member or collaborator.
 */
export async function resolveAssignee(
  ctx: DataContext,
  email: string,
): Promise<{ email: string; userId: string | null } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const people = await listPeople(ctx);
  const match = people.find((p) => p.email.toLowerCase() === target);
  return match ? { email: match.email, userId: match.id } : null;
}

/** GET `/_people` — the artifact's own people, for people ON the artifact.
 *  A bare session is not enough: on a PUBLIC artifact that would hand the whole
 *  workspace roster (emails, names, roles) to any signed-in stranger. */
export async function handlePeople(request: Request, ctx: DataContext): Promise<Response> {
  const session = await getSession(request, ctx);
  if (!session) {
    return errorResponse({ code: 'AUTH_REQUIRED', message: 'Authentication required', status: 401 });
  }

  const people = await listPeople(ctx);
  const email = session.email?.toLowerCase();
  const onArtifact = people.some((p) => p.id === session.userId || p.email.toLowerCase() === email);
  if (!onArtifact) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Not shared with you', status: 403 });
  }

  return successResponse({ people });
}
