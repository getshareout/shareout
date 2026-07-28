import type { Env } from './types';
import { generateId } from './crypto-utils';

// Account linking groups multiple `users` rows under a shared `identity_id`, so one
// login resolves to the whole set. Visibility queries (home, workspaces) union over
// these ids/emails. A NULL identity_id means the user is a group of one.

export interface LinkedAccount {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  is_current: boolean;
}

export interface VisibilityScope {
  userIds: string[];
  emails: string[];
}

/** SQL placeholder list; returns `NULL` for an empty set so `IN (NULL)` matches nothing. */
export function placeholders(n: number): string {
  return n > 0 ? Array.from({ length: n }, () => '?').join(',') : 'NULL';
}

export async function getLinkedUserIds(env: Env, userId: string): Promise<string[]> {
  const row = await env.DB.prepare('SELECT identity_id FROM users WHERE id = ?')
    .bind(userId).first<{ identity_id: string | null }>();
  if (!row?.identity_id) return [userId];
  const rows = await env.DB.prepare('SELECT id FROM users WHERE identity_id = ?')
    .bind(row.identity_id).all<{ id: string }>();
  const ids = (rows.results || []).map(r => r.id);
  return ids.includes(userId) ? ids : [userId, ...ids];
}

export async function getLinkedAccounts(env: Env, userId: string): Promise<LinkedAccount[]> {
  const row = await env.DB.prepare('SELECT identity_id FROM users WHERE id = ?')
    .bind(userId).first<{ identity_id: string | null }>();
  const cols = 'id, email, name, picture';
  if (!row?.identity_id) {
    const self = await env.DB.prepare(`SELECT ${cols} FROM users WHERE id = ?`)
      .bind(userId).first<Omit<LinkedAccount, 'is_current'>>();
    return self ? [{ ...self, is_current: true }] : [];
  }
  const rows = await env.DB.prepare(`SELECT ${cols} FROM users WHERE identity_id = ? ORDER BY created_at ASC`)
    .bind(row.identity_id).all<Omit<LinkedAccount, 'is_current'>>();
  return (rows.results || []).map(r => ({ ...r, is_current: r.id === userId }));
}

/** The full set of user ids + emails the session user can see across linked accounts. */
export async function getVisibilityScope(
  env: Env,
  user: { id: string; email: string | null },
): Promise<VisibilityScope> {
  const accounts = await getLinkedAccounts(env, user.id);
  const userIds = accounts.length ? accounts.map(a => a.id) : [user.id];
  const emails = accounts.map(a => a.email).filter((e): e is string => !!e);
  if (user.email && !emails.includes(user.email)) emails.push(user.email);
  return { userIds, emails };
}

/** Fold `otherUserId` (and its existing group) into the current user's identity group. */
export async function linkIdentity(
  env: Env,
  currentUserId: string,
  otherUserId: string,
): Promise<{ success: boolean; error?: string }> {
  if (currentUserId === otherUserId) return { success: true };

  const cur = await env.DB.prepare('SELECT identity_id FROM users WHERE id = ?')
    .bind(currentUserId).first<{ identity_id: string | null }>();
  const oth = await env.DB.prepare('SELECT identity_id FROM users WHERE id = ?')
    .bind(otherUserId).first<{ identity_id: string | null }>();
  if (!cur) return { success: false, error: 'Current account not found' };
  if (!oth) return { success: false, error: 'Account to link not found' };

  const identityId = cur.identity_id || generateId('idn');
  const groupIds = new Set<string>([currentUserId, otherUserId]);
  for (const idn of [cur.identity_id, oth.identity_id]) {
    if (!idn) continue;
    const members = await env.DB.prepare('SELECT id FROM users WHERE identity_id = ?')
      .bind(idn).all<{ id: string }>();
    for (const m of members.results || []) groupIds.add(m.id);
  }

  const ids = [...groupIds];
  await env.DB.prepare(`UPDATE users SET identity_id = ? WHERE id IN (${placeholders(ids.length)})`)
    .bind(identityId, ...ids).run();
  return { success: true };
}

/** Detach `targetUserId` back into its own solo identity. Cannot unlink the live session. */
export async function unlinkIdentity(
  env: Env,
  sessionUserId: string,
  targetUserId: string,
): Promise<{ success: boolean; error?: string }> {
  if (sessionUserId === targetUserId) {
    return { success: false, error: 'You cannot unlink the account you are signed in as' };
  }
  const ids = await getLinkedUserIds(env, sessionUserId);
  if (!ids.includes(targetUserId)) {
    return { success: false, error: 'That account is not linked to yours' };
  }
  await env.DB.prepare('UPDATE users SET identity_id = ? WHERE id = ?')
    .bind(generateId('idn'), targetUserId).run();
  return { success: true };
}
