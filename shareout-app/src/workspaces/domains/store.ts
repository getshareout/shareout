/**
 * Workspace custom domains: add, verify (refresh), remove, set primary, and the
 * takeover rules every write path shares.
 *
 *  - A hostname belongs to one workspace (unique index). An ACTIVE hostname can never
 *    move to another workspace; its owner has to remove it first.
 *  - Nothing routes until a refresh sees the provider confirm ownership (`active`).
 *  - Removing a hostname removes it from Cloudflare first; if that fails the row stays,
 *    so the zone never keeps a hostname we no longer know about.
 *  - A pending/failed claim older than STALE_CLAIM_MS can be taken over by another
 *    workspace, so nobody can squat a hostname they never verified.
 */
import type { Env } from '../../types';
import { generateId } from '../../crypto-utils';
import { createLogger, logError } from '../../logging';
import { invalidateWorkspaceHostnames } from '../host-cache';
import { cnameTarget, normalizeHostname, unclaimableReason } from './hostname';
import { invalidateWorkspacePrimaryHost } from './links';
import { ProviderError, providerFor, type ProviderName, type ProviderState } from './provider';

export const DOMAIN_STATUSES = ['pending', 'active', 'failed'] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const MAX_DOMAINS_PER_WORKSPACE = 10;
export const STALE_CLAIM_MS = 7 * 86_400_000;

export interface DomainRow {
  id: string;
  workspace_id: string;
  hostname: string;
  status: DomainStatus;
  is_primary: number;
  provider: ProviderName;
  provider_id: string | null;
  verification_method: string;
  verification_name: string | null;
  verification_token: string;
  ssl_status: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  last_checked_at: string | null;
}

export interface DomainView {
  id: string;
  hostname: string;
  status: DomainStatus;
  is_primary: boolean;
  provider: ProviderName;
  ssl_status: string | null;
  last_error: string | null;
  created_at: string;
  verified_at: string | null;
  last_checked_at: string | null;
  dns: Array<{ type: 'CNAME' | 'TXT'; name: string; value: string; purpose: string }>;
  instructions: string[];
}

export class DomainError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly hint?: string) {
    super(message);
  }
}

const COLS = 'id, workspace_id, hostname, status, is_primary, provider, provider_id, verification_method, verification_name, verification_token, ssl_status, last_error, created_by, created_at, updated_at, verified_at, last_checked_at';

export function toView(env: Env, row: DomainRow): DomainView {
  const dns: DomainView['dns'] = [
    { type: 'CNAME', name: row.hostname, value: cnameTarget(env), purpose: 'Sends the hostname to this instance.' },
  ];
  if (row.verification_name) {
    dns.push({ type: 'TXT', name: row.verification_name, value: row.verification_token, purpose: 'Proves you own the hostname.' });
  }
  const instructions = row.status === 'active'
    ? [`${row.hostname} is live.`]
    : row.provider === 'cloudflare'
      ? [
          `At your DNS provider, add a CNAME record: ${row.hostname} → ${cnameTarget(env)}.`,
          row.verification_name
            ? `Add the TXT record ${row.verification_name} with the value shown, so the hostname can be verified before traffic moves.`
            : 'Refresh in a minute to see the TXT verification record.',
          'Cloudflare issues the HTTPS certificate once the records resolve. Refresh to check; it usually takes a few minutes.',
        ]
      : [
          `At your DNS provider, add a CNAME record: ${row.hostname} → ${cnameTarget(env)}.`,
          `Add the TXT record ${row.verification_name} with the value shown, then refresh.`,
          'This instance has no Cloudflare for SaaS credentials, so its operator must also route the hostname to the Worker (a Workers custom domain or route) — HTTPS comes from that.',
        ];
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    is_primary: row.is_primary === 1,
    provider: row.provider,
    ssl_status: row.ssl_status,
    last_error: row.last_error,
    created_at: row.created_at,
    verified_at: row.verified_at,
    last_checked_at: row.last_checked_at,
    dns,
    instructions,
  };
}

function newVerificationToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `shareout-verify=${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function listDomains(env: Env, workspaceId: string): Promise<DomainRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${COLS} FROM workspace_domains WHERE workspace_id = ? ORDER BY is_primary DESC, created_at`,
  ).bind(workspaceId).all<DomainRow>();
  return results || [];
}

export async function getDomain(env: Env, workspaceId: string, domainId: string): Promise<DomainRow | null> {
  return env.DB.prepare(`SELECT ${COLS} FROM workspace_domains WHERE id = ? AND workspace_id = ?`)
    .bind(domainId, workspaceId).first<DomainRow>();
}

async function workspaceSlug(env: Env, workspaceId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT slug FROM workspaces WHERE id = ?').bind(workspaceId).first<{ slug: string }>();
  return row?.slug ?? null;
}

/** Drop the routing + primary-link caches that may name this workspace's hostnames. */
export async function invalidateDomainCaches(env: Env, workspaceId: string, ...hostnames: string[]): Promise<void> {
  const slug = await workspaceSlug(env, workspaceId);
  await Promise.all([invalidateWorkspaceHostnames(env, ...hostnames), invalidateWorkspacePrimaryHost(env, slug)]);
}

function providerFailure(err: unknown): DomainError {
  if (err instanceof DomainError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const status = err instanceof ProviderError && err.status === 409 ? 409 : 502;
  return new DomainError(status, 'DOMAIN_PROVIDER_ERROR', msg, 'Try again in a minute. If it keeps failing, the instance operator should check the custom-hostname credentials.');
}

/**
 * Claim `hostnameInput` for `workspaceId`. Callers have already checked the actor may
 * manage the workspace. Idempotent for the same workspace.
 */
export async function addDomain(
  env: Env,
  input: { workspaceId: string; hostname: unknown; actorId: string | null },
): Promise<{ row: DomainRow; created: boolean }> {
  const hostname = normalizeHostname(input.hostname);
  if (!hostname) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'hostname must be a hostname like portal.acme.example', 'Send just the hostname: no https://, path or port.');
  }
  const reason = unclaimableReason(env, hostname);
  if (reason) throw new DomainError(400, 'HOSTNAME_NOT_ALLOWED', reason);

  const existing = await env.DB.prepare(`SELECT ${COLS} FROM workspace_domains WHERE hostname = ?`).bind(hostname).first<DomainRow>();
  if (existing) {
    if (existing.workspace_id === input.workspaceId) return { row: existing, created: false };
    if (existing.status === 'active') {
      throw new DomainError(409, 'HOSTNAME_TAKEN', 'This hostname is already in use by another workspace.', 'Its current workspace has to remove it first.');
    }
    if (Date.now() - Date.parse(existing.created_at) < STALE_CLAIM_MS) {
      throw new DomainError(409, 'HOSTNAME_CLAIMED', 'Another workspace has a pending claim on this hostname.', 'Unverified claims expire after 7 days; then you can add it.');
    }
    await removeRow(env, existing);
  }

  const { results: countRows } = await env.DB.prepare('SELECT COUNT(*) AS n FROM workspace_domains WHERE workspace_id = ?')
    .bind(input.workspaceId).all<{ n: number }>();
  if ((countRows?.[0]?.n ?? 0) >= MAX_DOMAINS_PER_WORKSPACE) {
    throw new DomainError(409, 'DOMAIN_LIMIT', `A workspace can have at most ${MAX_DOMAINS_PER_WORKSPACE} custom domains.`);
  }

  const provider = providerFor(env);
  const token = newVerificationToken();
  let state: ProviderState;
  try {
    state = await provider.create(hostname, token);
  } catch (err) {
    throw providerFailure(err);
  }

  const id = generateId('wsd');
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO workspace_domains (id, workspace_id, hostname, status, provider, provider_id, verification_method, verification_name,
         verification_token, ssl_status, last_error, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, input.workspaceId, hostname, provider.name, state.providerId,
      state.verification?.method ?? (provider.name === 'cloudflare' ? 'cf_txt' : 'dns_txt'),
      state.verification?.name ?? null, state.verification?.value ?? token, state.sslStatus,
      state.errors.join(' ') || null, input.actorId, now, now,
    ).run();
  } catch (err) {
    // Lost a race on the unique hostname: undo what we provisioned.
    await provider.remove(state.providerId).catch(() => {});
    throw new DomainError(409, 'HOSTNAME_CLAIMED', 'This hostname was just claimed by another request.', String(err instanceof Error ? err.message : ''));
  }
  const row = await getDomain(env, input.workspaceId, id);
  return { row: row!, created: true };
}

function nextStatus(state: ProviderState): DomainStatus {
  if (state.active) return 'active';
  const hard = ['blocked', 'moved', 'deleted', 'test_failed'];
  if (hard.includes(state.status) || state.sslStatus === 'validation_timed_out' || state.sslStatus === 'expired') return 'failed';
  return 'pending';
}

/** Ask the provider for the hostname's state and record it. Only this activates a hostname. */
export async function refreshDomain(env: Env, workspaceId: string, domainId: string): Promise<DomainRow> {
  const row = await getDomain(env, workspaceId, domainId);
  if (!row) throw new DomainError(404, 'NOT_FOUND', 'Custom domain not found');
  let state: ProviderState;
  try {
    state = await providerFor(env, row.provider).refresh(row.hostname, row.provider_id, row.verification_token);
  } catch (err) {
    const e = providerFailure(err);
    await env.DB.prepare('UPDATE workspace_domains SET last_error = ?, last_checked_at = ?, updated_at = ? WHERE id = ?')
      .bind(e.message, new Date().toISOString(), new Date().toISOString(), row.id).run();
    throw e;
  }
  const status = nextStatus(state);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE workspace_domains SET status = ?, ssl_status = ?, last_error = ?, last_checked_at = ?, updated_at = ?,
       verification_name = COALESCE(?, verification_name), verification_token = COALESCE(?, verification_token),
       verified_at = CASE WHEN ? = 'active' THEN COALESCE(verified_at, ?) ELSE verified_at END
     WHERE id = ?`,
  ).bind(
    status, state.sslStatus, state.errors.join(' ') || null, now, now,
    state.verification?.name ?? null, state.verification?.value ?? null, status, now, row.id,
  ).run();
  if (status !== row.status) await invalidateDomainCaches(env, workspaceId, row.hostname);
  return (await getDomain(env, workspaceId, domainId))!;
}

async function removeRow(env: Env, row: DomainRow): Promise<void> {
  try {
    await providerFor(env, row.provider).remove(row.provider_id);
  } catch (err) {
    throw providerFailure(err);
  }
  await env.DB.prepare('DELETE FROM workspace_domains WHERE id = ?').bind(row.id).run();
  await invalidateDomainCaches(env, row.workspace_id, row.hostname);
}

export async function removeDomain(env: Env, workspaceId: string, domainId: string): Promise<DomainRow> {
  const row = await getDomain(env, workspaceId, domainId);
  if (!row) throw new DomainError(404, 'NOT_FOUND', 'Custom domain not found');
  await removeRow(env, row);
  return row;
}

export async function setPrimaryDomain(env: Env, workspaceId: string, domainId: string | null): Promise<void> {
  if (domainId) {
    const row = await getDomain(env, workspaceId, domainId);
    if (!row) throw new DomainError(404, 'NOT_FOUND', 'Custom domain not found');
    if (row.status !== 'active') {
      throw new DomainError(409, 'DOMAIN_NOT_ACTIVE', 'Only a verified, active domain can be primary.', 'Finish DNS setup and refresh first.');
    }
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE workspace_domains SET is_primary = 0, updated_at = ? WHERE workspace_id = ? AND is_primary = 1').bind(now, workspaceId),
    ...(domainId ? [env.DB.prepare('UPDATE workspace_domains SET is_primary = 1, updated_at = ? WHERE id = ? AND workspace_id = ?').bind(now, domainId, workspaceId)] : []),
  ]);
  await invalidateDomainCaches(env, workspaceId);
}

/**
 * Before a workspace is deleted: take every hostname off the provider so none is left
 * on the zone pointing nowhere (where someone else could claim it). Best-effort per
 * hostname; failures are logged and that row is left for the cascade.
 */
export async function releaseWorkspaceDomains(env: Env, workspaceId: string): Promise<void> {
  let rows: DomainRow[];
  try {
    rows = await listDomains(env, workspaceId);
  } catch {
    return;
  }
  for (const row of rows) {
    try {
      await removeRow(env, row);
    } catch (err) {
      logError(createLogger(env, { event: 'domains.release_failed', hostname: row.hostname }), 'custom hostname release failed', err);
    }
  }
}

/** Refresh every non-active domain of a workspace (the admin page's poll). */
export async function refreshPendingDomains(env: Env, workspaceId: string): Promise<void> {
  const rows = await listDomains(env, workspaceId);
  await Promise.all(rows.filter((r) => r.status !== 'active').map((r) => refreshDomain(env, workspaceId, r.id).catch(() => null)));
}
