import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { requireWorkspaceRole } from '../../workspaces';
import { logAudit } from '../../audit';
import { jsonWithApiErrors as json } from '../../http/api-error';
import { isLocale } from '../../i18n';

// The language a workspace speaks to its people (emails, agent, home, shared pages),
// and a person's own override of it. Admins set the workspace; anyone sets their own.

async function readLocale(request: Request): Promise<string | null | Response> {
  let body: { locale?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }
  return body.locale === null || isLocale(body.locale)
    ? (body.locale as string | null)
    : json({ error: "locale must be 'en' or 'es'", code: 'VALIDATION_ERROR' }, 400);
}

export async function handleGetWorkspaceLocale(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;
  const row = await env.DB.prepare('SELECT locale FROM workspaces WHERE id = ?')
    .bind(workspaceId)
    .first<{ locale: string }>();
  if (!row) return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  return json({ locale: row.locale });
}

export async function handleSetWorkspaceLocale(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;
  const locale = await readLocale(request);
  if (locale instanceof Response) return locale;
  if (!locale) return json({ error: "locale must be 'en' or 'es'", code: 'VALIDATION_ERROR' }, 400);
  const res = await env.DB.prepare(
    "UPDATE workspaces SET locale = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
  ).bind(locale, workspaceId).run();
  if (!res.meta.changes) return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'workspace.locale_update', targetType: 'workspace', targetId: workspaceId,
    detail: { locale },
  });
  return json({ locale });
}

/** PUT /v1/me/locale — `{ locale: 'en' | 'es' | null }`; null follows the workspace. */
export async function handleSetMyLocale(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const locale = await readLocale(request);
  if (locale instanceof Response) return locale;
  await env.DB.prepare('UPDATE users SET locale = ? WHERE id = ?').bind(locale, user.id).run();
  return json({ locale });
}
