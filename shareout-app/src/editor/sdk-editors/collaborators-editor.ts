import { dispatchAction } from './dispatch';
import { errorResponse, jsonResponse } from './response';
import type { SDKEditorContext, SDKEditorHandler } from './types';

// Collaborator mutations are owner-gated at the dispatch layer. Here we also
// prevent privilege escalation (role must be editor|viewer — never owner via this
// path) and owner lockout (cannot demote/remove an existing owner).
const ASSIGNABLE_ROLES = new Set(['editor', 'viewer']);

async function parseBody<T>(request: Request): Promise<T | null> {
  try { return await request.json() as T; } catch { return null; }
}

async function currentRole(ctx: SDKEditorContext, email: string): Promise<string | null> {
  const row = await ctx.env.DB.prepare(
    'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(ctx.artifactId, email).first<{ role: string }>();
  return row?.role ?? null;
}

export const handleCollaboratorsEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;

  return dispatchAction(action, {
    get: async () => {
      const collaborators = await env.DB.prepare(`
        SELECT c.email, c.role, c.invited_at, c.accepted_at, u.name, u.picture
        FROM collaborators c
        LEFT JOIN users u ON c.email = u.email
        WHERE c.artifact_id = ?
        ORDER BY c.role DESC, c.email
      `).bind(artifactId).all<{
        email: string;
        role: string;
        invited_at: string;
        accepted_at: string | null;
        name: string | null;
        picture: string | null;
      }>();

      return jsonResponse({
        success: true,
        collaborators: collaborators.results?.map(c => ({
          email: c.email,
          role: c.role,
          name: c.name,
          picture: c.picture,
          invitedAt: c.invited_at,
          accepted: c.accepted_at !== null,
        })) || [],
      });
    },

    invite: async () => {
      const body = await parseBody<{ email?: string; role?: string }>(request);
      if (!body) return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400);
      if (!body.email || !body.role) {
        return errorResponse('INVALID_REQUEST', 'email and role required', 400);
      }
      if (!ASSIGNABLE_ROLES.has(body.role)) {
        return errorResponse('INVALID_ROLE', 'role must be "editor" or "viewer"', 400);
      }
      if (await currentRole(ctx, body.email) === 'owner') {
        return errorResponse('FORBIDDEN', 'Cannot change the owner', 403);
      }

      await env.DB.prepare(`
        INSERT INTO collaborators (artifact_id, email, role, invited_at)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT(artifact_id, email) DO UPDATE SET
          role = excluded.role
      `).bind(artifactId, body.email, body.role).run();

      return jsonResponse({ success: true });
    },

    update: async () => {
      const body = await parseBody<{ email?: string; role?: string }>(request);
      if (!body) return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400);
      if (!body.email || !body.role) {
        return errorResponse('INVALID_REQUEST', 'email and role required', 400);
      }
      if (!ASSIGNABLE_ROLES.has(body.role)) {
        return errorResponse('INVALID_ROLE', 'role must be "editor" or "viewer"', 400);
      }
      if (await currentRole(ctx, body.email) === 'owner') {
        return errorResponse('FORBIDDEN', 'Cannot change the owner’s role', 403);
      }

      await env.DB.prepare(`
        UPDATE collaborators SET role = ? WHERE artifact_id = ? AND email = ?
      `).bind(body.role, artifactId, body.email).run();

      return jsonResponse({ success: true });
    },

    remove: async () => {
      const body = await parseBody<{ email?: string }>(request);
      if (!body) return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400);
      if (!body.email) return errorResponse('INVALID_REQUEST', 'email required', 400);
      if (await currentRole(ctx, body.email) === 'owner') {
        return errorResponse('FORBIDDEN', 'Cannot remove the owner', 403);
      }

      await env.DB.prepare(`
        DELETE FROM collaborators WHERE artifact_id = ? AND email = ?
      `).bind(artifactId, body.email).run();

      return jsonResponse({ success: true });
    },
  });
};
