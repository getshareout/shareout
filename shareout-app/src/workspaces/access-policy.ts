import type { Env, WorkspaceAccessPolicy } from '../types';
import { generateId } from '../crypto-utils';
import type { AuthUser } from '../api-auth';
import { json } from './json-response';
import { requireWorkspaceRole, invalidateWorkspaceRole } from './roles';
import { logAudit } from '../audit';

export const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

export function parseJsonList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export async function getWorkspaceAccessPolicy(
  env: Env,
  workspaceId: string
): Promise<WorkspaceAccessPolicy | null> {
  const row = await env.DB.prepare(
    'SELECT allowed_email_domains, allowed_emails FROM workspaces WHERE id = ?'
  ).bind(workspaceId).first<{ allowed_email_domains: string | null; allowed_emails: string | null }>();
  if (!row) return null;
  return {
    allowed_domains: parseJsonList(row.allowed_email_domains),
    allowed_emails: parseJsonList(row.allowed_emails),
  };
}

export function isEmailAllowedByPolicy(policy: WorkspaceAccessPolicy, email: string): boolean {
  if (policy.allowed_domains.length === 0 && policy.allowed_emails.length === 0) return true;
  const normalized = email.trim().toLowerCase();
  if (policy.allowed_emails.includes(normalized)) return true;
  const domain = normalized.split('@')[1] || '';
  return policy.allowed_domains.includes(domain);
}

export async function handleGetWorkspaceAccessPolicy(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;

  const policy = await getWorkspaceAccessPolicy(env, workspaceId);
  if (!policy) {
    return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  }

  return json(policy);
}

export async function handleUpdateWorkspaceAccessPolicy(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  let body: { allowed_domains?: unknown; allowed_emails?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const current = await getWorkspaceAccessPolicy(env, workspaceId);
  if (!current) {
    return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  }

  let domains = current.allowed_domains;
  if (body.allowed_domains !== undefined) {
    if (!Array.isArray(body.allowed_domains)) {
      return json({ error: 'allowed_domains must be an array', code: 'VALIDATION_ERROR' }, 400);
    }
    domains = [...new Set(body.allowed_domains.map((d) => normalizeDomain(String(d))).filter(Boolean))];
    const invalid = domains.find((d) => !DOMAIN_REGEX.test(d));
    if (invalid) {
      return json({ error: `Invalid domain: ${invalid}`, code: 'INVALID_DOMAIN' }, 400);
    }
  }

  let emails = current.allowed_emails;
  if (body.allowed_emails !== undefined) {
    if (!Array.isArray(body.allowed_emails)) {
      return json({ error: 'allowed_emails must be an array', code: 'VALIDATION_ERROR' }, 400);
    }
    emails = [...new Set(body.allowed_emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    const invalid = emails.find((e) => !e.includes('@') || !DOMAIN_REGEX.test(e.split('@')[1] || ''));
    if (invalid) {
      return json({ error: `Invalid email: ${invalid}`, code: 'INVALID_EMAIL' }, 400);
    }
  }

  await env.DB.prepare(
    "UPDATE workspaces SET allowed_email_domains = ?, allowed_emails = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).bind(
    domains.length ? JSON.stringify(domains) : null,
    emails.length ? JSON.stringify(emails) : null,
    workspaceId
  ).run();

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'access_policy.update', targetType: 'workspace', targetId: workspaceId,
    detail: { domain_count: domains.length, email_count: emails.length },
  });

  return json({ allowed_domains: domains, allowed_emails: emails });
}

/** True when global sign-ups are paused but this email may still create an account. */
export async function hasWorkspaceSignupAllowlist(env: Env, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split('@')[1] || '';
  if (!normalized.includes('@')) return false;

  const rows = await env.DB.prepare(
    'SELECT allowed_email_domains, allowed_emails FROM workspaces WHERE allowed_email_domains IS NOT NULL OR allowed_emails IS NOT NULL'
  ).bind().all<{ allowed_email_domains: string | null; allowed_emails: string | null }>();

  for (const row of rows.results || []) {
    const domains = parseJsonList(row.allowed_email_domains);
    const emails = parseJsonList(row.allowed_emails);
    if (emails.includes(normalized)) return true;
    if (domain && domains.includes(domain)) return true;
  }
  return false;
}

/** Auto-join workspaces whose domain allowlist matches the user's email domain on sign-in. */
export async function autoJoinWorkspacesByDomain(
  env: Env,
  userId: string,
  email: string | null
): Promise<void> {
  const domain = (email || '').trim().toLowerCase().split('@')[1] || '';
  if (!domain) return;

  const rows = await env.DB.prepare(
    'SELECT id, allowed_email_domains FROM workspaces WHERE allowed_email_domains IS NOT NULL'
  ).bind().all<{ id: string; allowed_email_domains: string | null }>();

  for (const row of rows.results || []) {
    if (!parseJsonList(row.allowed_email_domains).includes(domain)) continue;
    const existing = await env.DB.prepare(
      'SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
    ).bind(row.id, userId).first();
    if (existing) continue;
    await env.DB.prepare(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'member')"
    ).bind(generateId('wsm'), row.id, userId).run();
    await invalidateWorkspaceRole(env, row.id, userId);
  }
}
