/**
 * Outbound HTTP for the MCP client. Every URL here comes from a remote server
 * (the MCP URL an admin typed, then whatever its discovery metadata points at),
 * so each request and each redirect hop goes through the SSRF blocklist, and
 * this instance's own hosts are refused.
 */
import type { Env } from '../types';
import { fetchCheckingRedirects, isBlockedDestination } from '../data/secrets/blocklist';
import { getPlatformOrigin } from '../config/origins';

export const MCP_TIMEOUT_MS = 25_000;
export const MCP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type McpErrorCode =
  | 'needs_auth'
  | 'server_unavailable'
  | 'blocked_destination'
  | 'bad_response'
  | 'registration_unsupported'
  | 'tool_error'
  | 'rpc_error';

export class McpClientError extends Error {
  constructor(
    public code: McpErrorCode,
    message: string,
    public detail?: { wwwAuthenticate?: string | null; status?: number },
  ) {
    super(message);
    this.name = 'McpClientError';
  }
}

function ownHosts(env: Env): Set<string> {
  const hosts = new Set<string>();
  for (const raw of [getPlatformOrigin(env), env.ARTIFACT_ORIGIN]) {
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).hostname.toLowerCase());
    } catch { /* unset or malformed */ }
  }
  return hosts;
}

export function refuseDestination(env: Env, url: URL): string | null {
  if (url.protocol !== 'https:') return 'MCP and OAuth endpoints must use https';
  const blocked = isBlockedDestination(url.toString());
  if (blocked.blocked) return blocked.reason || 'blocked destination';
  const host = url.hostname.toLowerCase();
  for (const own of ownHosts(env)) {
    if (host === own || host.endsWith(`.${own}`)) return 'cannot target this ShareOut instance';
  }
  return null;
}

export async function guardedFetch(env: Env, url: string, init: RequestInit = {}): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new McpClientError('blocked_destination', `Invalid URL: ${url}`);
  }
  const refusal = refuseDestination(env, parsed);
  if (refusal) throw new McpClientError('blocked_destination', refusal);
  try {
    return await fetchCheckingRedirects(
      parsed.toString(),
      { ...init, signal: init.signal ?? AbortSignal.timeout(MCP_TIMEOUT_MS) },
      (next) => refuseDestination(env, next),
      { stripCredentialsCrossOrigin: true },
    );
  } catch (err) {
    if (err instanceof McpClientError) throw err;
    if (err instanceof Error && err.name === 'BlockedRedirectError') {
      throw new McpClientError('blocked_destination', err.message);
    }
    throw new McpClientError('server_unavailable', err instanceof Error ? err.message : 'request failed');
  }
}

export async function readCappedText(res: Response): Promise<string> {
  const declared = Number(res.headers.get('Content-Length') || 0);
  if (declared > MCP_MAX_RESPONSE_BYTES) {
    await res.body?.cancel();
    throw new McpClientError('bad_response', 'Response too large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MCP_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new McpClientError('bad_response', 'Response too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

export async function fetchJson<T>(env: Env, url: string, init: RequestInit = {}): Promise<{ status: number; body: T | null; headers: Headers }> {
  const res = await guardedFetch(env, url, { ...init, headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
  const text = await readCappedText(res);
  let body: T | null;
  try {
    body = text ? (JSON.parse(text) as T) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}
