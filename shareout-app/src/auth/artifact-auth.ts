import { parseSubdomainFromEnv } from '../subdomain';
import type { Env } from '../types';
import {
  createAccessToken,
  verifyAccessToken as verifyAccessTokenRaw,
  extractTokenFromCookie,
} from '../token';
import { SESSION_MAX_AGE } from './constants';
import { credentialsLoginPage, passwordLoginPage } from './pages';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * After auth, return to the artifact on the same host (subdomain vs apex).
 *
 * The subdomain test used to be a literal `.shareout.site` suffix check, so on a
 * self-hosted instance a workspace subdomain (team.acme.com) was never recognised
 * and the redirect went to the apex path `/a/{slug}/` — which that host does not
 * serve. Entering the password on a protected artifact left you somewhere else.
 */
function artifactLocation(request: Request, slug: string, env: Env): string {
  const host = new URL(request.url).hostname;
  return parseSubdomainFromEnv(host, env).isSubdomain ? `/${slug}` : `/a/${slug}/`;
}

export async function handlePasswordAuth(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const slug = formData.get('slug') as string;
  const artifactId = formData.get('artifact_id') as string | null;
  const password = formData.get('password') as string;

  if (!slug || !password) {
    return new Response('Bad Request', { status: 400 });
  }

  // artifacts.slug is no longer globally unique — resolve by id when the login
  // form carried one (it always does now), falling back to the routing slug via
  // the deployment join for any in-flight legacy page.
  const artifact = artifactId
    ? await env.DB.prepare(
        'SELECT id, name, password_hash FROM artifacts WHERE id = ?'
      ).bind(artifactId).first<{ id: string; name: string; password_hash: string }>()
    : await env.DB.prepare(
        `SELECT a.id, a.name, a.password_hash FROM artifacts a
         JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
         WHERE d.slug = ?`
      ).bind(slug).first<{ id: string; name: string; password_hash: string }>();

  if (!artifact || !artifact.password_hash) {
    return new Response('Not Found', { status: 404 });
  }

  const inputHash = await hashPassword(password);

  if (inputHash !== artifact.password_hash) {
    return passwordLoginPage(slug, artifact.name, 'Incorrect password', undefined, artifact.id);
  }

  const accessToken = await createAccessToken(artifact.id, 'password', env, SESSION_MAX_AGE);

  return new Response(null, {
    status: 302,
    headers: {
      Location: artifactLocation(request, slug, env),
      'Set-Cookie': `shareout_access_${artifact.id}=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`,
    },
  });
}

export async function handleCredentialsAuth(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const slug = formData.get('slug') as string;
  const artifactId = formData.get('artifact_id') as string | null;
  const username = formData.get('username') as string;
  const password = formData.get('password') as string;

  if (!slug || !username || !password) {
    return new Response('Bad Request', { status: 400 });
  }

  // Resolve by id (form-supplied) since artifacts.slug is now per-workspace;
  // fall back to the globally-unique routing slug for any in-flight legacy page.
  const artifact = artifactId
    ? await env.DB.prepare(
        'SELECT id, name FROM artifacts WHERE id = ?'
      ).bind(artifactId).first<{ id: string; name: string }>()
    : await env.DB.prepare(
        `SELECT a.id, a.name FROM artifacts a
         JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
         WHERE d.slug = ?`
      ).bind(slug).first<{ id: string; name: string }>();

  if (!artifact) {
    return new Response('Not Found', { status: 404 });
  }

  const inputHash = await hashPassword(password);

  const credential = await env.DB.prepare(
    'SELECT 1 FROM artifact_passwords WHERE artifact_id = ? AND username = ? AND password_hash = ?'
  ).bind(artifact.id, username.toLowerCase().trim(), inputHash).first();

  if (!credential) {
    return credentialsLoginPage(slug, artifact.name, 'Invalid username or password', undefined, artifact.id);
  }

  const accessToken = await createAccessToken(artifact.id, `cred:${username}`, env, SESSION_MAX_AGE);

  return new Response(null, {
    status: 302,
    headers: {
      Location: artifactLocation(request, slug, env),
      'Set-Cookie': `shareout_access_${artifact.id}=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`,
    },
  });
}

export async function verifyAccessToken(
  request: Request,
  env: Env,
  artifactId: string
): Promise<boolean> {
  const cookie = request.headers.get('Cookie');
  const token = extractTokenFromCookie(cookie, new RegExp(`shareout_access_${artifactId}=([^;]+)`));
  if (!token) return false;

  const payload = await verifyAccessTokenRaw(token, artifactId, env);
  return payload !== null;
}
