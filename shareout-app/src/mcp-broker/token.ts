/**
 * Short-lived broker token. The artifact's own data token lives two hours and page
 * code can read it, so the broker accepts only this: five minutes, bound to the
 * artifact, the viewer and the page's current MCP declaration. The host page mints
 * it on request with the viewer's session cookie and hands it to the frame.
 */
import type { Env } from '../types';
import { signPayload, verifySignature } from '../token';

export const MCP_TOKEN_TTL_SECONDS = 5 * 60;
const PREFIX = 'mcpt.';

export interface McpTokenPayload {
  a: string;
  u: string;
  h: string;
  exp: number;
}

const tokenKey = (env: Env) => `mcp-broker:${env.SESSION_SECRET}`;

export async function createMcpToken(env: Env, artifactId: string, userId: string, capabilityHash: string): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.floor(Date.now() / 1000) + MCP_TOKEN_TTL_SECONDS;
  const encoded = btoa(JSON.stringify({ a: artifactId, u: userId, h: capabilityHash, exp } satisfies McpTokenPayload));
  return { token: `${PREFIX}${encoded}.${await signPayload(encoded, tokenKey(env))}`, expiresAt: exp * 1000 };
}

export async function verifyMcpToken(env: Env, token: string | null | undefined, artifactId: string): Promise<McpTokenPayload | null> {
  if (!token?.startsWith(PREFIX)) return null;
  try {
    const [encoded, sig] = token.slice(PREFIX.length).split('.');
    if (!encoded || !sig || !(await verifySignature(encoded, sig, tokenKey(env)))) return null;
    const payload = JSON.parse(atob(encoded)) as McpTokenPayload;
    if (payload.a !== artifactId || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
