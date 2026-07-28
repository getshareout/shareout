import { getInternalWorkspaceRole } from '../../workspaces';
import { logAudit } from '../../audit';
import { setArtifactPaused, setArtifactVisibility } from '../../superadmin/artifacts-admin';
import { transferArtifactOwnership } from '../../artifacts/collaborators';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';

/** Workspace-admin artifact governance: list, pause, visibility, transfer.
 *  Split out of workspaces.ts to keep the main router under the size cap. */
export async function routeWorkspaceAdminArtifacts(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  const adminArtifactsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/admin\/artifacts$/);
  if (adminArtifactsMatch && request.method === 'GET') {
    const [, workspaceId] = adminArtifactsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
    if (!role || (role !== 'owner' && role !== 'admin')) {
      return addCORS(Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }));
    }
    const rows = await env.DB.prepare(`
      SELECT
        a.id, a.name, a.artifact_type, a.slug, a.created_at, a.visibility, a.access_policy, a.paused,
        a.owner_id, u.email AS owner_email, u.name AS owner_name,
        w.slug AS workspace_slug,
        COALESCE(vt.views, 0) AS views, COALESCE(vt.unique_visitors, 0) AS unique_visitors,
        COALESCE(sz.size_bytes, 0) AS size_bytes,
        pf.avg_lcp AS avg_lcp, COALESCE(pf.perf_samples, 0) AS perf_samples,
        (SELECT created_at FROM versions WHERE artifact_id = a.id ORDER BY version_no DESC LIMIT 1) AS updated_at
      FROM artifacts a
      LEFT JOIN users u ON a.owner_id = u.id
      LEFT JOIN artifact_view_totals vt ON a.id = vt.artifact_id
      LEFT JOIN workspaces w ON a.workspace_id = w.id
      LEFT JOIN (
        SELECT v.artifact_id, SUM(s.size_bytes) AS size_bytes
        FROM versions v JOIN assets s ON s.version_id = v.id
        GROUP BY v.artifact_id
      ) sz ON sz.artifact_id = a.id
      LEFT JOIN (
        SELECT artifact_id, AVG(lcp) AS avg_lcp, COUNT(*) AS perf_samples
        FROM artifact_perf WHERE lcp IS NOT NULL
        GROUP BY artifact_id
      ) pf ON pf.artifact_id = a.id
      WHERE a.workspace_id = ?
      ORDER BY a.created_at DESC
      LIMIT 200
    `).bind(workspaceId).all();
    return addCORS(Response.json({ artifacts: rows.results || [] }));
  }

  const adminArtifactActionMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/admin\/artifacts\/([^/]+)\/(pause|visibility|transfer)$/);
  if (adminArtifactActionMatch && request.method === 'POST') {
    const [, workspaceId, artifactId, action] = adminArtifactActionMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
    if (!role || (role !== 'owner' && role !== 'admin')) {
      return addCORS(Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }));
    }
    const owns = await env.DB.prepare('SELECT id, owner_id FROM artifacts WHERE id = ? AND workspace_id = ?')
      .bind(artifactId, workspaceId).first<{ id: string; owner_id: string }>();
    if (!owns) return addCORS(Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 }));

    if (action === 'pause') {
      const body = await request.json<{ paused?: boolean }>().catch(() => ({}) as { paused?: boolean });
      const paused = body.paused !== false;
      await setArtifactPaused(env, artifactId, paused);
      await logAudit(env, {
        workspaceId, actorId: user.id, actorEmail: user.email,
        action: paused ? 'artifact.pause' : 'artifact.unpause', targetType: 'artifact', targetId: artifactId,
      });
      return addCORS(Response.json({ ok: true, paused }));
    }
    if (action === 'transfer') {
      const body = await request.json<{ email?: string }>().catch(() => ({}) as { email?: string });
      const email = (body.email || '').toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return addCORS(Response.json({ error: 'Valid email required', code: 'INVALID_EMAIL' }, { status: 400 }));
      }
      // Internal only: handing an artifact to an external (Sharee) identity would make
      // them its owner, which is the one path that bypasses the grant spine entirely.
      const member = await env.DB.prepare(
        `SELECT u.id FROM users u JOIN workspace_members wm ON wm.user_id = u.id
         WHERE u.email = ? AND wm.workspace_id = ? AND wm.member_class = 'internal'`
      ).bind(email, workspaceId).first();
      if (!member) {
        return addCORS(Response.json({ error: 'New owner must be a workspace member', code: 'NOT_A_MEMBER' }, { status: 400 }));
      }
      const fail = await transferArtifactOwnership(env, artifactId, owns.owner_id, email, user.id);
      if (fail) return addCORS(Response.json({ error: fail.error, code: fail.code }, { status: fail.status }));
      await logAudit(env, {
        workspaceId, actorId: user.id, actorEmail: user.email,
        action: 'artifact.transfer', targetType: 'artifact', targetId: artifactId, detail: { new_owner: email },
      });
      return addCORS(Response.json({ ok: true, new_owner: email }));
    }
    const body = await request.json<{ visibility?: string }>().catch(() => ({}) as { visibility?: string });
    const result = await setArtifactVisibility(env, artifactId, body.visibility || '');
    if (!result.ok) return addCORS(Response.json({ error: result.error, code: 'BAD_REQUEST' }, { status: 400 }));
    await logAudit(env, {
      workspaceId, actorId: user.id, actorEmail: user.email,
      action: 'artifact.visibility', targetType: 'artifact', targetId: artifactId,
      detail: { visibility: body.visibility },
    });
    return addCORS(Response.json({ ok: true, visibility: body.visibility }));
  }

  return null;
}
