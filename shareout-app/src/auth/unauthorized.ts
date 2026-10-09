import type { Env } from '../types';
import { sha256 } from '../crypto-utils';
import { unauthorized, type UnauthorizedReason } from '../cors';

/**
 * Why a bearer key was rejected — only computed on the failure path, so the extra
 * lookup never touches a successful request.
 */
export async function tokenFailureReason(request: Request, env: Env): Promise<UnauthorizedReason> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ') || !authHeader.slice(7).trim()) return 'missing';
  const token = authHeader.slice(7);
  if (!token.startsWith('so_') && !token.startsWith('sot_')) return 'invalid';
  const hash = await sha256(new TextEncoder().encode(token).buffer as ArrayBuffer);
  const row = await env.DB.prepare('SELECT revoked_at, expires_at FROM tokens WHERE token_hash = ?')
    .bind(hash).first<{ revoked_at: string | null; expires_at: string | null }>()
    .catch(() => null);
  if (row?.revoked_at) return 'revoked';
  if (row?.expires_at && row.expires_at <= new Date().toISOString()) return 'expired';
  return 'invalid';
}

/** 401 that names the cause (missing / invalid / revoked / expired) and how to fix it. */
export async function unauthorizedFor(request: Request, env: Env): Promise<Response> {
  return unauthorized(await tokenFailureReason(request, env), new URL(request.url).origin);
}
