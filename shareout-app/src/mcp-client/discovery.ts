/**
 * MCP authorization discovery (spec 2025-11-25): 401 challenge → RFC 9728
 * protected resource metadata → RFC 8414 / OIDC authorization server metadata.
 */
import type { Env } from '../types';
import { fetchJson, McpClientError } from './http';
import { openSession } from './transport';

export interface McpAuthConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  cimdSupported: boolean;
  tokenAuthMethods: string[];
  scopes: string[];
  resource: string;
}

export type DiscoveryResult = { auth: 'none' } | { auth: 'oauth'; oauth: McpAuthConfig };

interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

interface AuthServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  client_id_metadata_document_supported?: boolean;
  token_endpoint_auth_methods_supported?: string[];
}

/** RFC 8707 canonical URI: lowercase scheme and host, no fragment or query, no trailing slash. */
export function canonicalServerUri(raw: string): string {
  const u = new URL(raw);
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.host}`.toLowerCase() + path;
}

export function parseWwwAuthenticate(header: string | null | undefined): { resourceMetadata?: string; scope?: string } {
  if (!header) return {};
  const out: { resourceMetadata?: string; scope?: string } = {};
  for (const m of header.matchAll(/([a-zA-Z_]+)\s*=\s*"([^"]*)"/g)) {
    if (m[1] === 'resource_metadata') out.resourceMetadata = m[2];
    if (m[1] === 'scope') out.scope = m[2];
  }
  return out;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

function protectedResourceCandidates(serverUrl: string, fromHeader?: string): string[] {
  if (fromHeader) return [fromHeader];
  const u = new URL(serverUrl);
  const path = trimSlash(u.pathname);
  return [
    ...(path ? [`${u.origin}/.well-known/oauth-protected-resource${path}`] : []),
    `${u.origin}/.well-known/oauth-protected-resource`,
  ];
}

function authServerCandidates(issuer: string): string[] {
  const u = new URL(issuer);
  const path = trimSlash(u.pathname);
  if (!path) {
    return [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
  }
  return [
    `${u.origin}/.well-known/oauth-authorization-server${path}`,
    `${u.origin}/.well-known/openid-configuration${path}`,
    `${u.origin}${path}/.well-known/openid-configuration`,
  ];
}

async function firstJson<T>(env: Env, urls: string[]): Promise<T | null> {
  for (const url of urls) {
    const { status, body } = await fetchJson<T>(env, url);
    if (status === 200 && body && typeof body === 'object') return body;
  }
  return null;
}

export async function discoverAuth(env: Env, serverUrl: string): Promise<DiscoveryResult> {
  let challenge: { resourceMetadata?: string; scope?: string };
  try {
    await openSession(env, serverUrl, null);
    return { auth: 'none' };
  } catch (err) {
    if (!(err instanceof McpClientError) || err.code !== 'needs_auth') throw err;
    challenge = parseWwwAuthenticate(err.detail?.wwwAuthenticate);
  }

  const prm = await firstJson<ProtectedResourceMetadata>(env, protectedResourceCandidates(serverUrl, challenge.resourceMetadata));
  const issuer = prm?.authorization_servers?.[0];
  if (!prm || !issuer) {
    throw new McpClientError('bad_response', 'MCP server did not publish OAuth protected resource metadata');
  }

  const canonical = canonicalServerUri(serverUrl);
  const resource = prm.resource ? canonicalServerUri(prm.resource) : canonical;
  if (new URL(resource).origin !== new URL(canonical).origin) {
    throw new McpClientError('bad_response', 'Protected resource metadata names a different server');
  }

  const as = await firstJson<AuthServerMetadata>(env, authServerCandidates(issuer));
  if (!as) throw new McpClientError('bad_response', 'Authorization server metadata not found');
  if (as.issuer && trimSlash(as.issuer) !== trimSlash(issuer)) {
    throw new McpClientError('bad_response', 'Authorization server issuer mismatch');
  }
  if (!as.authorization_endpoint || !as.token_endpoint) {
    throw new McpClientError('bad_response', 'Authorization server metadata is missing endpoints');
  }
  if (!as.code_challenge_methods_supported?.includes('S256')) {
    throw new McpClientError('bad_response', 'Authorization server does not support PKCE S256');
  }

  const scopes = challenge.scope ? challenge.scope.split(/\s+/).filter(Boolean) : (prm.scopes_supported ?? []);
  return {
    auth: 'oauth',
    oauth: {
      issuer: trimSlash(issuer),
      authorizationEndpoint: as.authorization_endpoint,
      tokenEndpoint: as.token_endpoint,
      registrationEndpoint: as.registration_endpoint,
      cimdSupported: as.client_id_metadata_document_supported === true,
      tokenAuthMethods: as.token_endpoint_auth_methods_supported ?? [],
      scopes,
      resource,
    },
  };
}
