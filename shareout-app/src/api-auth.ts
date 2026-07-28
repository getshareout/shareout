import type { Env } from './types';
import { generateId } from './crypto-utils';
import { signupsPaused, SIGNUPS_PAUSED_MSG } from './signup-gate';
import { scheduleSeedStarterKit } from './starter-kit';
import { isSuperAdminEmail } from './superadmin/auth';
import { jsonWithApiErrors } from './http/api-error';

const RATE_LIMIT_WINDOW = 60 * 60 * 24; // 24 hours in seconds
const RATE_LIMIT_MAX = 100; // publishes per day

export type ServiceScope = 'artifacts:read' | 'artifacts:publish' | 'data:read' | 'data:write';

export const SERVICE_SCOPES: ServiceScope[] = [
  'artifacts:read',
  'artifacts:publish',
  'data:read',
  'data:write',
];

// Present only when the request authenticated with an `sot_` workspace Agent token.
// Carries the token's single-workspace boundary + action scopes so callers can gate.
export interface ServiceContext {
  tokenId: string;
  workspaceId: string;
  scopes: ServiceScope[];
  // External-sharing spine (work/030) Phase 3: set when this is an EXTERNAL token
  // (tokens.subject_external_user_id). Its action scopes still apply, but
  // resource access is NOT workspace-blanket — every read/write must additionally
  // resolve through `grants` for this user (enforced at the data seam).
  externalUserId?: string | null;
}

export interface AuthUser {
  id: string;
  email: string | null;
  username: string | null;
  // Set iff this is a service-account (Agent) token. Human/personal tokens omit it,
  // so every existing caller that reads id/email/username is unaffected.
  service?: ServiceContext | null;
}

// True when the caller may perform `scope`. Humans and personal `so_` tokens have no
// service context → full access (bypass). Service tokens must list the scope.
export function hasScope(user: AuthUser, scope: ServiceScope): boolean {
  if (!user.service) return true;
  return user.service.scopes.includes(scope);
}

export interface CreateAccountResponse {
  token: string;
  user_id: string;
}

export interface UserProfile {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `so_${token}`;
}

// Workspace Agent token. Distinct `sot_` prefix so resolveToken routes it to the
// principal_type='workspace' path instead of the personal one.
export function generateServiceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `sot_${token}`;
}

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function handleCreateAccount(
  request: Request,
  env: Env,
  executionCtx?: ExecutionContext
): Promise<Response> {
  if (signupsPaused(env)) {
    return new Response(JSON.stringify({ error: SIGNUPS_PAUSED_MSG }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = generateId('usr');
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const tokenId = generateId('tok');

  await env.DB.prepare(
    'INSERT INTO users (id, email, name) VALUES (?, NULL, NULL)'
  ).bind(userId).run();

  await env.DB.prepare(
    "INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, ?)"
  ).bind(tokenId, userId, userId, tokenHash, 'default').run();

  // Brand-new account — seed the personal starter kit in the background.
  scheduleSeedStarterKit(env, { id: userId, email: null, username: null }, { workspaceId: null, tier: 'personal' }, executionCtx);

  const response: CreateAccountResponse = {
    token,
    user_id: userId,
  };

  return new Response(JSON.stringify(response), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleLinkEmail(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (!body.email || !isValidEmail(body.email)) {
    return json({ error: 'Invalid email', code: 'INVALID_EMAIL' }, 400);
  }

  const email = body.email.toLowerCase().trim();

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? AND id != ?'
  ).bind(email, user.id).first();

  if (existing) {
    return json({ error: 'Email already in use', code: 'EMAIL_IN_USE' }, 409);
  }

  await env.DB.prepare(
    'UPDATE users SET email = ? WHERE id = ?'
  ).bind(email, user.id).run();

  return json({ success: true, email });
}

const LAST_USED_THROTTLE_TTL = 300; // 5 min — last_used_at precision nobody can perceive

const tokenMemo = new WeakMap<Request, Promise<AuthUser | null>>();

export async function validateToken(
  request: Request,
  env: Env
): Promise<AuthUser | null> {
  const memoized = tokenMemo.get(request);
  if (memoized) return memoized;

  const pending = resolveToken(request, env);
  tokenMemo.set(request, pending);
  return pending;
}

async function resolveToken(request: Request, env: Env): Promise<AuthUser | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);

  // Workspace Agent token → authenticate AS its service principal, carrying the
  // single-workspace boundary + scopes. ('sot_' does not match 'so_' below.)
  if (token.startsWith('sot_')) return resolveServiceToken(token, env);

  if (!token.startsWith('so_')) return null;

  const tokenHash = await hashToken(token);

  const result = await env.DB.prepare(`
    SELECT t.user_id, u.email, u.username
    FROM tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
    AND t.principal_type = 'user'
    AND t.revoked_at IS NULL
    AND (t.expires_at IS NULL OR t.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).bind(tokenHash).first<{ user_id: string; email: string | null; username: string | null }>();

  if (!result) return null;

  await touchLastUsed(env, tokenHash);

  return { id: result.user_id, email: result.email, username: result.username };
}

async function resolveServiceToken(token: string, env: Env): Promise<AuthUser | null> {
  const tokenHash = await hashToken(token);

  const row = await env.DB.prepare(`
    SELECT t.id AS token_id, t.user_id AS principal_user_id, t.principal_id AS workspace_id, t.scopes,
           t.subject_external_user_id, u.email, u.username
    FROM tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
      AND t.principal_type = 'workspace'
      AND t.revoked_at IS NULL
      AND (t.expires_at IS NULL OR t.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).bind(tokenHash).first<{
    token_id: string;
    principal_user_id: string;
    workspace_id: string;
    scopes: string;
    subject_external_user_id: string | null;
    email: string | null;
    username: string | null;
  }>();

  if (!row) return null;

  await touchLastUsed(env, tokenHash, 'sottokused');

  const scopes = row.scopes
    .split(',')
    .map(s => s.trim())
    .filter((s): s is ServiceScope => (SERVICE_SCOPES as string[]).includes(s));

  return {
    id: row.principal_user_id,
    email: row.email,
    username: row.username,
    service: {
      tokenId: row.token_id,
      workspaceId: row.workspace_id,
      scopes,
      externalUserId: row.subject_external_user_id ?? null,
    },
  };
}

// last_used_at is soft "when was this token last used" metadata. Throttle the
// write behind a KV marker so it runs at most once per token per window instead
// of on every authenticated request. Fail open: any KV/D1 error falls through to
// the write and never fails an otherwise-valid auth.
async function touchLastUsed(env: Env, tokenHash: string, markerPrefix = 'tokused'): Promise<void> {
  if (env.SLUGS) {
    try {
      if (await env.SLUGS.get(`${markerPrefix}:${tokenHash}`)) return;
    } catch { /* KV blip → fall through and write */ }
  }

  try {
    await env.DB.prepare(
      "UPDATE tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ?"
    ).bind(tokenHash).run();
    if (env.SLUGS) {
      try {
        await env.SLUGS.put(`${markerPrefix}:${tokenHash}`, '1', { expirationTtl: LAST_USED_THROTTLE_TTL });
      } catch { /* marker write best-effort */ }
    }
  } catch { /* never fail auth on a metadata-write error */ }
}

export async function handleGetProfile(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT id, email, username, name, metadata, created_at
    FROM users WHERE id = ?
  `).bind(user.id).first<{
    id: string;
    email: string | null;
    username: string | null;
    name: string | null;
    metadata: string | null;
    created_at: string;
  }>();

  if (!result) {
    return json({ error: 'User not found', code: 'NOT_FOUND' }, 404);
  }

  const profile: UserProfile = {
    id: result.id,
    email: result.email,
    username: result.username,
    name: result.name,
    metadata: result.metadata ? JSON.parse(result.metadata) : {},
    created_at: result.created_at,
  };

  return json(profile);
}

export async function handleUpdateProfile(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  let body: { username?: string; name?: string; metadata?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.username !== undefined) {
    if (body.username && !isValidUsername(body.username)) {
      return json({ error: 'Invalid username (3-32 chars, alphanumeric and underscores)', code: 'INVALID_USERNAME' }, 400);
    }
    const username = body.username ? body.username.toLowerCase().trim() : null;
    if (username) {
      const existing = await env.DB.prepare(
        'SELECT id FROM users WHERE username = ? AND id != ?'
      ).bind(username, user.id).first();
      if (existing) {
        return json({ error: 'Username already taken', code: 'USERNAME_TAKEN' }, 409);
      }
    }
    updates.push('username = ?');
    values.push(username);
  }

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name || null);
  }

  if (body.metadata !== undefined) {
    updates.push('metadata = ?');
    values.push(JSON.stringify(body.metadata));
  }

  if (updates.length === 0) {
    return json({ error: 'No fields to update', code: 'NO_UPDATES' }, 400);
  }

  values.push(user.id);
  await env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return handleGetProfile(request, env, user);
}

function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{3,32}$/.test(username);
}

export async function checkRateLimit(
  env: Env,
  userId: string,
  action: string,
  email?: string | null
): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  if (isSuperAdminEmail(email, env)) {
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setUTCHours(0, 0, 0, 0);
    const resetTime = new Date(windowStart);
    resetTime.setUTCDate(resetTime.getUTCDate() + 1);
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX,
      reset: Math.floor(resetTime.getTime() / 1000),
    };
  }

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setUTCHours(0, 0, 0, 0);
  const windowKey = windowStart.toISOString();

  const result = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE principal_type = 'user' AND principal_id = ? AND action = ? AND window_start = ?"
  ).bind(userId, action, windowKey).first<{ count: number }>();

  const currentCount = result?.count || 0;
  const remaining = Math.max(0, RATE_LIMIT_MAX - currentCount);
  const resetTime = new Date(windowStart);
  resetTime.setUTCDate(resetTime.getUTCDate() + 1);

  return {
    allowed: currentCount < RATE_LIMIT_MAX,
    remaining,
    reset: Math.floor(resetTime.getTime() / 1000),
  };
}

export async function incrementRateLimit(
  env: Env,
  userId: string,
  action: string,
  email?: string | null
): Promise<void> {
  if (isSuperAdminEmail(email, env)) return;

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setUTCHours(0, 0, 0, 0);
  const windowKey = windowStart.toISOString();

  await env.DB.prepare(`
    INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count)
    VALUES ('user', ?, ?, ?, 1)
    ON CONFLICT(principal_type, principal_id, action, window_start) DO UPDATE SET count = count + 1
  `).bind(userId, action, windowKey).run();
}

const PRESENT_LIMIT_ACTION = 'present';
const PRESENT_LIMIT_MAX = 10; // decks per user per UTC hour

// Same rate_limits table/pattern as checkRateLimit/incrementRateLimit above, but
// hour-bucketed (window_start is a free-text column, so a distinct action + finer
// window needs no schema change) — publish's day window is too coarse for an
// LLM-backed endpoint.
export async function checkPresentLimit(
  env: Env,
  userId: string,
  email?: string | null
): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  const windowStart = new Date();
  windowStart.setUTCMinutes(0, 0, 0);
  const reset = Math.floor(windowStart.getTime() / 1000) + 3600;
  if (isSuperAdminEmail(email, env)) {
    return { allowed: true, remaining: PRESENT_LIMIT_MAX, reset };
  }

  const result = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE principal_type = 'user' AND principal_id = ? AND action = ? AND window_start = ?"
  ).bind(userId, PRESENT_LIMIT_ACTION, windowStart.toISOString()).first<{ count: number }>();
  const currentCount = result?.count || 0;

  return {
    allowed: currentCount < PRESENT_LIMIT_MAX,
    remaining: Math.max(0, PRESENT_LIMIT_MAX - currentCount),
    reset,
  };
}

export async function incrementPresentLimit(
  env: Env,
  userId: string,
  email?: string | null
): Promise<void> {
  if (isSuperAdminEmail(email, env)) return;

  const windowStart = new Date();
  windowStart.setUTCMinutes(0, 0, 0);

  await env.DB.prepare(`
    INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count)
    VALUES ('user', ?, ?, ?, 1)
    ON CONFLICT(principal_type, principal_id, action, window_start) DO UPDATE SET count = count + 1
  `).bind(userId, PRESENT_LIMIT_ACTION, windowStart.toISOString()).run();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

const ADMIN_SESSION_EXPIRY = 15 * 60; // 15 minutes

function generateAdminToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface AdminSessionResponse {
  admin_url: string;
  expires_in: number;
  session_token: string;
}

export async function handleCreateAdminSession(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  let body: { artifact_id?: string; slug?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  let artifactId = body.artifact_id;
  let slug: string | undefined;

  if (!artifactId && body.slug) {
    const deployment = await env.DB.prepare(`
      SELECT a.id, d.slug FROM deployments d
      JOIN artifacts a ON a.id = d.artifact_id
      WHERE d.slug = ? AND d.channel = 'production'
    `).bind(body.slug).first<{ id: string; slug: string }>();

    if (!deployment) {
      return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
    }
    artifactId = deployment.id;
    slug = deployment.slug;
  }

  if (!artifactId) {
    return json({ error: 'artifact_id or slug required', code: 'MISSING_PARAM' }, 400);
  }

  const artifact = await env.DB.prepare(`
    SELECT a.id, a.owner_id, d.slug FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE a.id = ?
  `).bind(artifactId).first<{ id: string; owner_id: string | null; slug: string | null }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  if (artifact.owner_id !== user.id) {
    const collab = await env.DB.prepare(`
      SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?
    `).bind(artifactId, user.email).first<{ role: string }>();

    if (!collab || collab.role === 'viewer') {
      return json({ error: 'Access denied', code: 'FORBIDDEN' }, 403);
    }
  }

  slug = slug || artifact.slug || undefined;
  if (!slug) {
    return json({ error: 'Artifact has no deployment', code: 'NO_DEPLOYMENT' }, 400);
  }

  const sessionToken = generateAdminToken();
  const sessionId = generateId('adm');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_EXPIRY * 1000).toISOString();
  const ip = request.headers.get('cf-connecting-ip') || null;

  await env.DB.prepare(`
    INSERT INTO admin_sessions (id, user_id, artifact_id, session_token, expires_at, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(sessionId, user.id, artifactId, sessionToken, expiresAt, ip).run();

  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  const adminUrl = `${baseUrl}/a/${slug}/admin?session=${sessionToken}`;

  const response: AdminSessionResponse = {
    admin_url: adminUrl,
    expires_in: ADMIN_SESSION_EXPIRY,
    session_token: sessionToken,
  };

  return json(response, 201);
}

export async function validateAdminSession(
  env: Env,
  sessionToken: string
): Promise<{ userId: string; artifactId: string } | null> {
  const now = new Date().toISOString();

  const session = await env.DB.prepare(`
    SELECT id, user_id, artifact_id FROM admin_sessions
    WHERE session_token = ? AND expires_at > ? AND used_at IS NULL
  `).bind(sessionToken, now).first<{ id: string; user_id: string; artifact_id: string }>();

  if (!session) return null;

  await env.DB.prepare(`
    UPDATE admin_sessions SET used_at = ? WHERE id = ?
  `).bind(now, session.id).run();

  return { userId: session.user_id, artifactId: session.artifact_id };
}

// Rate-limit rows are per (principal, action, window) and nothing ever deleted them.
// Every window key starts with YYYY-MM-DD — ISO day, ISO hour, bare date, or the
// agent's YYYY-MM-DDTHH:MM — so one string cutoff prunes all of them. Two days of
// slack keeps the widest window (a UTC day) intact while it is still being counted.
export async function cleanupOldRateLimits(env: Env): Promise<number> {
  const cutoff = new Date(Date.now() - 2 * 86400 * 1000).toISOString().slice(0, 10);
  const result = await env.DB.prepare(
    'DELETE FROM rate_limits WHERE window_start < ?'
  ).bind(cutoff).run();
  return result.meta?.changes || 0;
}

export async function cleanupExpiredAdminSessions(env: Env): Promise<number> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    DELETE FROM admin_sessions WHERE expires_at < ?
  `).bind(now).run();
  return result.meta?.changes || 0;
}
