/**
 * Password sign-in endpoints.
 *
 * Three of them, and the split matters:
 *   POST /v1/auth/password/register — creates the FIRST admin, and only while the
 *     instance has no users. This is what lets `/setup` finish on a fresh deploy
 *     with no mail provider and no OAuth client. Once a user exists it 404s, so it
 *     can never become an open registration endpoint.
 *   POST /v1/auth/password/login — email + password, mints the same session cookie
 *     every other sign-in path mints.
 *   POST /v1/auth/password — set or change the password on the signed-in account.
 *     Changing an existing one requires the current password.
 */
import type { FetchContext } from '../router/context';
import { getSessionUser } from './index';
import { getTokenOrSessionUser } from '../router/helpers/auth-guard';
import { createSessionCookieForUser } from './session';
import { needsSetup, schemaReady } from '../pages/setup';
import { checkPasswordLoginLimit, rateLimitResponse } from '../rate-limit';
import { scheduleSeedStarterKit } from '../starter-kit';
import { scheduleWelcomeEmail, scheduleWorkspaceWelcome } from '../onboarding/welcome-email';
import { generateId } from '../crypto-utils';
import {
  hasPassword,
  passwordProblem,
  setUserPassword,
  verifyUserPassword,
  verifyPassword,
} from './password';

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readBody(ctx: FetchContext): Promise<{ email?: string; password?: string; current_password?: string; name?: string }> {
  return (await ctx.request.json().catch(() => ({}))) as Record<string, string>;
}

/**
 * First-admin registration. Open only while `users` is empty — the same condition
 * that makes `/setup` render. After that this endpoint does not exist, so it cannot
 * be used to self-register on someone else's instance.
 */
export async function handlePasswordRegister(ctx: FetchContext): Promise<Response> {
  const { env } = ctx;
  // needsSetup() is also true when the schema is missing entirely — it catches the
  // query error. Separate the two so a Deploy-button instance with no tables gets
  // the command that fixes it instead of a 500 from the INSERT below.
  if (!(await schemaReady(env))) {
    return json({
      ok: false,
      error: 'The database schema has not been applied yet. Run: npx wrangler d1 migrations apply DB --remote',
    }, 503);
  }
  if (!(await needsSetup(env))) {
    return json({ ok: false, error: 'This instance already has an admin.' }, 404);
  }

  const body = await readBody(ctx);
  const email = (body.email || '').toLowerCase().trim();
  const password = body.password || '';

  if (!isValidEmail(email)) return json({ ok: false, error: 'Enter a valid email address.' }, 400);

  // SETUP_ADMIN_EMAIL, when set, pins who the first admin is — otherwise whoever
  // reaches this endpoint first owns the instance.
  const pinned = env.SETUP_ADMIN_EMAIL?.trim().toLowerCase();
  if (pinned && pinned !== email) {
    return json({ ok: false, error: `This instance is set up for ${pinned}.` }, 403);
  }

  const problem = passwordProblem(password);
  if (problem) return json({ ok: false, error: problem }, 400);

  // Not upsertUserByEmail: that path enforces the signup gate and the invite
  // allowlist, neither of which can be satisfied on an instance with no users yet.
  const id = generateId('usr');
  // Same shape upsertUserByEmail writes, including the email local-part fallback for
  // `name` — the home UI greets people by it.
  const name = (body.name || '').trim() || email.split('@')[0] || 'there';
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, last_login_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  ).bind(id, email, name).run();
  await setUserPassword(env, id, password);

  scheduleSeedStarterKit(env, { id, email, username: null }, { workspaceId: null, tier: 'personal' }, ctx.executionCtx);

  const cookie = await createSessionCookieForUser(env, ctx.url, id, email);
  return json({ ok: true, user: { email } }, 200, { 'Set-Cookie': cookie });
}

export async function handlePasswordLogin(ctx: FetchContext): Promise<Response> {
  const rl = await checkPasswordLoginLimit(ctx.env, ctx.request);
  if (!rl.allowed) return rateLimitResponse(rl);

  const body = await readBody(ctx);
  const user = await verifyUserPassword(ctx.env, body.email || '', body.password || '');

  // One message for every failure — unknown address, no password set, wrong
  // password. Anything more specific is an account-enumeration oracle.
  if (!user) return json({ ok: false, error: 'That email and password do not match.' }, 401);

  if (user.firstActivation) {
    scheduleWorkspaceWelcome(ctx.env, user.id, user.email, ctx.executionCtx);
    scheduleWelcomeEmail(ctx.env, user.email, ctx.executionCtx);
  }

  const cookie = await createSessionCookieForUser(ctx.env, ctx.url, user.id, user.email);
  return json({ ok: true, user: { email: user.email } }, 200, { 'Set-Cookie': cookie });
}

/** Set a first password, or change an existing one (which needs the current one). */
export async function handlePasswordSet(ctx: FetchContext): Promise<Response> {
  const user = await getTokenOrSessionUser(ctx);
  if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

  const body = await readBody(ctx);
  const password = body.password || '';
  const problem = passwordProblem(password);
  if (problem) return json({ ok: false, error: problem }, 400);

  if (await hasPassword(ctx.env, user.id)) {
    // Rotating a password is only safe if the caller proves they know the old one —
    // a stolen session should not be enough to lock the owner out of their account.
    const current = body.current_password || '';
    const row = await ctx.env.DB.prepare(
      'SELECT hash, salt, iterations, algo FROM user_passwords WHERE user_id = ?',
    ).bind(user.id).first<{ hash: string; salt: string; iterations: number; algo: string }>();
    if (!row || !(await verifyPassword(current, row))) {
      return json({ ok: false, error: 'Current password is incorrect.' }, 403);
    }
  }

  await setUserPassword(ctx.env, user.id, password);
  return json({ ok: true });
}

/** Whether the signed-in account has a password — drives the Settings UI. */
export async function handlePasswordStatus(ctx: FetchContext): Promise<Response> {
  const user = await getSessionUser(ctx.request, ctx.env);
  if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
  return json({ ok: true, has_password: await hasPassword(ctx.env, user.id) });
}
