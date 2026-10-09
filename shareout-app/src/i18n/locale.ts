import type { Env } from '../types';

/** Languages the product speaks. Spanish is rioplatense (es-AR, voseo). */
export type Locale = 'en' | 'es';

export const LOCALES: readonly Locale[] = ['en', 'es'];

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'es';
}

/** BCP 47 tag for Intl formatting and the html lang attribute. */
export function localeTag(locale: Locale): string {
  return locale === 'es' ? 'es-AR' : 'en-US';
}

/** First supported language in an Accept-Language header, by q-weight. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { lang: tag.split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { lang } of ranked) if (isLocale(lang)) return lang;
  return null;
}

/** Person's own choice → their workspace's language → their browser → English. */
export function resolveLocale(opts: {
  workspace?: string | null;
  user?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(opts.user)) return opts.user;
  if (isLocale(opts.workspace)) return opts.workspace;
  return localeFromAcceptLanguage(opts.acceptLanguage) ?? 'en';
}

export async function getWorkspaceLocale(env: Env, workspaceId: string | null | undefined): Promise<Locale | null> {
  if (!workspaceId) return null;
  const row = await env.DB.prepare('SELECT locale FROM workspaces WHERE id = ?')
    .bind(workspaceId)
    .first<{ locale: string | null }>();
  return isLocale(row?.locale) ? row.locale : null;
}

/** Locale for a shared page: its workspace's language, else the viewer's browser. */
export async function localeForArtifactWorkspace(
  env: Env,
  workspaceId: string | null | undefined,
  request: Request,
): Promise<Locale> {
  return resolveLocale({
    workspace: await getWorkspaceLocale(env, workspaceId).catch(() => null),
    acceptLanguage: request.headers.get('Accept-Language'),
  });
}

/**
 * Locale for a person we're writing to (email, bot reply). Their own choice wins;
 * else the named workspace; else the workspace they joined most recently.
 */
export async function localeForRecipient(
  env: Env,
  opts: { userId?: string | null; workspaceId?: string | null },
): Promise<Locale> {
  const { userId, workspaceId } = opts;
  if (!userId) return (await getWorkspaceLocale(env, workspaceId)) ?? 'en';
  const row = await env.DB.prepare(
    `SELECT u.locale AS user_locale,
            (SELECT locale FROM workspaces WHERE id = ?) AS ws_locale,
            (SELECT w.locale FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
              WHERE wm.user_id = u.id ORDER BY wm.created_at DESC LIMIT 1) AS member_locale
       FROM users u WHERE u.id = ?`,
  )
    .bind(workspaceId ?? null, userId)
    .first<{ user_locale: string | null; ws_locale: string | null; member_locale: string | null }>();
  return resolveLocale({ user: row?.user_locale, workspace: row?.ws_locale ?? row?.member_locale });
}
