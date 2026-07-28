/**
 * Shared types and constants for artifact-scoped generic connections.
 *
 * Connections live in one D1 table (`connections`), credentials inline.
 * Artifact-local rows are resolved first, then workspace-shared ones
 * and referenced — not copied — when an artifact queries them.
 */
import type { WorkspaceCredentialScope } from './user-credentials';

/** Default timeout for REST connection tests and queries (ms). */
export const CONNECTION_TIMEOUT_MS = 15_000;

export const NAME_PATTERN = /^[a-zA-Z0-9_\-]+$/;

// ponytail: 'postgres' hidden until a server-side engine exists (work/023); existing rows still resolve.
export const CONNECTION_TYPES = ['rest_api', 'bigquery', 'snowflake'] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export interface ConnectionRow {
  id: string;
  artifact_id: string;
  name: string;
  type: string;
  config: string;
  credentials_id: string | null;
  cache_ttl_seconds: number;
  rate_limit_rpm: number;
  created_at: string;
  updated_at: string;
}

export interface ConnectionConfig {
  name: string;
  type: ConnectionType;
  config: Record<string, unknown>;
  credentials?: {
    type: 'api_key' | 'basic_auth' | 'oauth' | 'service_account';
    data: Record<string, unknown>;
  };
  cacheTtl?: number;
  rateLimit?: number;
}

/** A connection resolved for query/test/materialize — artifact-local or workspace-shared. */
export interface ResolvedGenericConnection {
  id: string;
  type: string;
  config: string;
  cache_ttl_seconds: number;
  rate_limit_rpm: number;
  encrypted_data: string | null;
  iv: string | null;
  cred_type: string | null;
  scope: 'artifact' | 'workspace';
  workspace_id?: string | null;
  credential_scope?: WorkspaceCredentialScope;
}

export interface ListedConnection {
  name: string;
  type: string;
  cacheTtl: number;
  rateLimit: number;
  createdAt: string;
  scope: 'artifact' | 'workspace';
  credentialScope?: WorkspaceCredentialScope;
}
