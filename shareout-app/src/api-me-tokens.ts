import type { Env } from './types';
import type { AuthUser } from './api-auth';
import { generateToken, hashToken } from './api-auth';
import { generateId } from './crypto-utils';
import { jsonWithApiErrors } from './http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

// Self-serve: lists the signed-in user's own API tokens (metadata only — plaintext is never recoverable).
export async function handleListMyTokens(env: Env, user: AuthUser): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, name, created_at, last_used_at FROM tokens WHERE principal_type = 'user' AND principal_id = ? ORDER BY created_at DESC",
  ).bind(user.id).all();
  return json({ ok: true, count: results.length, tokens: results });
}

// Self-serve: mints a token for the signed-in user. With { regenerate: true } it revokes
// the user's existing tokens first, so they end with exactly one.
export async function handleCreateMyToken(request: Request, env: Env, user: AuthUser): Promise<Response> {
  let regenerate = false;
  try {
    const body = (await request.json()) as { regenerate?: boolean };
    regenerate = body?.regenerate === true;
  } catch {
    // empty body → plain generate
  }

  if (regenerate) {
    await env.DB.prepare("DELETE FROM tokens WHERE principal_type = 'user' AND principal_id = ?").bind(user.id).run();
  }

  const token = generateToken();
  const tokenHash = await hashToken(token);
  await env.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, ?)")
    .bind(generateId('tok'), user.id, user.id, tokenHash, 'self-serve').run();

  // Plaintext is returned exactly once and never stored.
  return json({ ok: true, token, shown_once: true });
}
