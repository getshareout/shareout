import { isSuperAdminEmail } from '../../superadmin/auth';

export async function requireSuperAdminOwner(
  env: { DB: D1Database },
  ownerId: string
): Promise<string | null> {
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(ownerId)
    .first<{ email: string | null }>();
  if (!isSuperAdminEmail(row?.email)) {
    return 'This tool is only available to ShareOut platform super-admins.';
  }
  return null;
}
