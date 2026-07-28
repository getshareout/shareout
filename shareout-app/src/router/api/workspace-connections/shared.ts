/**
 * Shared helpers for workspace connection API routes — JSON responses,
 * name validation, and workspace role guards.
 */
import type { Env } from '../../../types';
import { getInternalWorkspaceRole } from '../../../workspaces';
import { jsonWithApiErrors } from '../../../http/api-error';

// ponytail: 'postgres' hidden until a server-side engine exists (work/023); existing rows still resolve.
export const GENERIC_TYPES = ['rest_api', 'bigquery', 'snowflake'] as const;
export const STATIC_AUTH_TYPES = ['api_key', 'basic_auth', 'service_account'] as const;
export const CREDENTIAL_SCOPES = ['shared', 'per_user'] as const;
export type CredentialScope = (typeof CREDENTIAL_SCOPES)[number];

const NAME_PATTERN = /^[a-zA-Z0-9_\-]+$/;

/** Standard JSON response helper for connection routes. */
export function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

/** Validate a connector name (alphanumeric, underscore, hyphen; max 64 chars). */
export function validateName(name: string): string | null {
  if (!name) return 'Name is required';
  if (name.length > 64) return 'Name too long (max 64 chars)';
  if (!NAME_PATTERN.test(name)) return 'Name contains invalid characters';
  return null;
}

/** True when the user is any member of the workspace. */
export async function requireMember(env: Env, workspaceId: string, userId: string): Promise<boolean> {
  return (await getInternalWorkspaceRole(env, workspaceId, userId)) !== null;
}

/**
 * True when the user is workspace owner or admin.
 * Adding, deleting, or OAuth-installing shared connectors is an admin action;
 * any member can list and use them by name.
 */
export async function requireAdmin(env: Env, workspaceId: string, userId: string): Promise<boolean> {
  const role = await getInternalWorkspaceRole(env, workspaceId, userId);
  return role === 'owner' || role === 'admin';
}
