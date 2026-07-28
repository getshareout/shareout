import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { hasWorkspaceSignupAllowlist } from '../workspaces';
import { signupsPaused, SIGNUPS_PAUSED_MSG } from '../signup-gate';
import { notifySuperadmins } from '../superadmin/recipients';

export interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
}

async function hasExplicitArtifactInvite(env: Env, email: string): Promise<boolean> {
  const collaborator = await env.DB.prepare(
    'SELECT 1 FROM collaborators WHERE email = ? LIMIT 1'
  ).bind(email).first();
  return !!collaborator;
}

/** Find-or-create a user from an email alone (no Google). */
export async function upsertUserByEmail(
  env: Env,
  emailRaw: string
): Promise<{ id: string; email: string; isNew: boolean; firstActivation: boolean }> {
  const email = emailRaw.toLowerCase().trim();
  const existing = await env.DB.prepare(
    'SELECT id, email, last_login_at FROM users WHERE email = ?'
  ).bind(email).first<{ id: string; email: string; last_login_at: string | null }>();

  if (existing) {
    // Same firstActivation rule as upsertUser — pre-created invitees have a row but
    // never logged in; isNew alone would skip their workspace welcome.
    const firstActivation = !existing.last_login_at;
    await env.DB.prepare(
      `UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).bind(existing.id).run();
    return { id: existing.id, email: existing.email, isNew: false, firstActivation };
  }

  // Private artifact shares and workspace allowlists are explicit invitations.
  // Let those emails create accounts even while open sign-ups are paused.
  if (
    signupsPaused(env)
    && !(await hasExplicitArtifactInvite(env, email))
    && !(await hasWorkspaceSignupAllowlist(env, email))
  ) {
    throw new Error(SIGNUPS_PAUSED_MSG);
  }

  const id = generateId('usr');
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, last_login_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(id, email, email.split('@')[0] || 'there').run();
  void notifySuperadmins(env, `🎉 New signup: ${email}`).catch(() => {});
  return { id, email, isNew: true, firstActivation: true };
}

/**
 * Find-or-create a user from a Google profile (OAuth / One Tap).
 *
 * `firstActivation` = this is the first time the account has ever logged in — true for
 * a brand-new signup AND for a pre-created invitee (a users row inserted at invite time
 * with last_login_at NULL) activating for the first time. `isNew` alone can't tell those
 * apart, which is why invitees used to silently lose their welcome.
 */
export async function upsertUser(env: Env, info: GoogleUserInfo): Promise<{ id: string; email: string; isNew: boolean; firstActivation: boolean }> {
  // Canonical lowercase, same as the OTP path. `users.email` is UNIQUE but SQLite
  // compares TEXT case-sensitively, and every sharing join (collaborators.email,
  // sharee_members.email, grants identity emails) stores lowercase — a Workspace
  // domain that hands back `First.Last@corp.com` would otherwise mint a SECOND
  // account and silently miss every share addressed to the person.
  const email = (info.email || '').toLowerCase().trim();
  const existing = await env.DB.prepare(
    'SELECT id, email FROM users WHERE google_id = ?'
  ).bind(info.id).first<{ id: string; email: string }>();

  if (existing) {
    // google_id is only ever set during a prior Google login, so this is a return visit.
    await env.DB.prepare(
      `UPDATE users SET name = ?, picture = ?, last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).bind(info.name, info.picture, existing.id).run();
    return { ...existing, isNew: false, firstActivation: false };
  }

  // Adopt an account that already owns this email (e.g. pre-created by invite, or created
  // via API token then linked by email) instead of inserting a duplicate and tripping
  // UNIQUE(email).
  const byEmail = await env.DB.prepare(
    'SELECT id, google_id, last_login_at FROM users WHERE email = ?'
  ).bind(email).first<{ id: string; google_id: string | null; last_login_at: string | null }>();

  if (byEmail) {
    if (byEmail.google_id && byEmail.google_id !== info.id) {
      throw new Error('This email is already linked to a different Google account');
    }
    const firstActivation = !byEmail.last_login_at;
    await env.DB.prepare(
      `UPDATE users SET google_id = ?, name = COALESCE(name, ?), picture = ?, last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).bind(info.id, info.name, info.picture, byEmail.id).run();
    return { id: byEmail.id, email, isNew: false, firstActivation };
  }

  if (
    signupsPaused(env)
    && !(await hasExplicitArtifactInvite(env, email))
    && !(await hasWorkspaceSignupAllowlist(env, email))
  ) {
    throw new Error(SIGNUPS_PAUSED_MSG);
  }

  const id = generateId('usr');
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, google_id, last_login_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ).bind(id, email, info.name, info.picture, info.id).run();

  void notifySuperadmins(env, `🎉 New signup: ${email}`).catch(() => {});
  return { id, email, isNew: true, firstActivation: true };
}

/** Attach a Google account to an existing ShareOut user (account linking flow). */
export async function linkGoogleToUser(
  env: Env,
  userId: string,
  info: GoogleUserInfo
): Promise<{ success: boolean; error?: string }> {
  const existingGoogle = await env.DB.prepare(
    'SELECT id FROM users WHERE google_id = ?'
  ).bind(info.id).first<{ id: string }>();

  if (existingGoogle) {
    if (existingGoogle.id === userId) {
      return { success: true };
    }
    return { success: false, error: 'This Google account is already linked to another user' };
  }

  const user = await env.DB.prepare(
    'SELECT id, google_id FROM users WHERE id = ?'
  ).bind(userId).first<{ id: string; google_id: string | null }>();

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (user.google_id && user.google_id !== info.id) {
    return { success: false, error: 'Your account already has a different Google account linked' };
  }

  await env.DB.prepare(
    'UPDATE users SET google_id = ?, email = COALESCE(email, ?), name = COALESCE(name, ?), picture = ? WHERE id = ?'
  ).bind(info.id, (info.email || '').toLowerCase().trim(), info.name, info.picture, userId).run();

  return { success: true };
}
