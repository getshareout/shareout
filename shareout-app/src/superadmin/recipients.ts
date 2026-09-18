/**
 * Super-admin roster.
 *
 * Two sources, both consulted:
 *   - `INSTANCE_ADMIN_EMAILS` — comma-separated, set on the Worker. This is the one
 *     a self-hoster uses: adding an instance admin should not mean editing a file in
 *     the repo and redeploying a fork.
 *   - `superadmin-recipients.json` — the baked roster, empty in the public tree.
 *     Still read so an operator who prefers a committed roster can keep one.
 *
 * `SETUP_ADMIN_EMAIL` also counts, so the first admin never locks themselves out.
 *
 * Grants access only. Super-admins are not notified out-of-band: the `/admin`
 * cockpit is the whole surface.
 */
import type { Env } from '../types';
import roster from '../../superadmin-recipients.json';

export interface SuperAdminRecipient {
  email: string;
}

export const SUPERADMIN_RECIPIENTS: readonly SuperAdminRecipient[] = roster.recipients;

export const SUPERADMIN_EMAILS: readonly string[] = SUPERADMIN_RECIPIENTS.map((r) => r.email);

/** Emails from `INSTANCE_ADMIN_EMAILS`, lowercased and de-blanked. */
export function envAdminEmails(env?: Env): string[] {
  return (env?.INSTANCE_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
}

export function isSuperAdminEmail(email: string | null | undefined, env?: Env): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();
  if (SUPERADMIN_EMAILS.map((e) => e.toLowerCase()).includes(normalized)) return true;
  if (envAdminEmails(env).includes(normalized)) return true;
  const setup = env?.SETUP_ADMIN_EMAIL?.toLowerCase().trim();
  if (setup && setup === normalized) return true;
  return false;
}

/**
 * True when nothing names an instance admin, so the earliest user is treated as one.
 * `env` is optional only because older call sites do not have it — pass it where you
 * can, or an instance configured purely through `INSTANCE_ADMIN_EMAILS` keeps handing
 * admin to whoever signed up first.
 */
export function rosterIsEmpty(env?: Env): boolean {
  return SUPERADMIN_EMAILS.length === 0 && envAdminEmails(env).length === 0;
}
