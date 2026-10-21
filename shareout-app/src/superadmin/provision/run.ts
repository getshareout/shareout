/**
 * One-step workspace provisioning for a new customer account.
 *
 * Runs a validated {@link ProvisionSpec} as a sequence of steps — workspace, branding,
 * policy, folders, admins, connectors, then the custom-domain hook. Every
 * step is idempotent and keyed by the workspace slug: a re-run fills in what is missing
 * and reports the rest as `unchanged`; it never creates a second workspace, folder,
 * membership or connector, never resends a live invite (unless asked), and never
 * overwrites a stored connector credential.
 *
 * A step that fails is reported and the run continues, so one refused connector does
 * not cost the operator the invites. Each step writes its own audit row; no audit row
 * or response ever carries a credential value.
 */
import type { Env, WorkspaceRole } from '../../types';
import { generateId } from '../../crypto-utils';
import { logAudit } from '../../audit';
import { createWorkspaceForUser } from '../../workspaces/crud';
import { inviteOrAddMember } from '../../workspaces/invite';
import { invalidateWorkspaceSlug } from '../../workspaces/host-cache';
import { loadBranding, saveBranding, logoExtFor, logoProblem, storeWorkspaceLogo } from '../../workspaces/branding';
import { parseJsonList } from '../../workspaces/access-policy';
import { generateFolderSlug } from '../../folders';
import { getOverrides, setWorkspaceFlag } from '../../features/flags';
import { isKnowledgeEnabled, setKnowledgeEnabled } from '../../knowledge/store';
import { createWorkspaceConnection } from '../../router/api/workspace-connections/crud';
import { fetchCheckingRedirects, isBlockedDestination } from '../../data/secrets/blocklist';
import { getPlatformHostname, getPlatformOrigin } from '../../config/origins';
import type { ProvisionSpec } from './spec';
import { getProvisionHook, type ProvisionHookName } from './hooks';
import { BUILTIN_PROVISION_HOOKS } from './builtin-hooks';

export type StepStatus = 'created' | 'updated' | 'unchanged' | 'skipped' | 'pending' | 'failed';

export interface StepResult {
  step: string;
  status: StepStatus;
  detail?: Record<string, unknown>;
  error?: string;
  next_step?: string;
}

export interface AdminInviteSummary {
  email: string;
  role: WorkspaceRole;
  status: 'invited' | 'already_invited' | 'active' | 'added' | 'failed';
  email_sent?: boolean;
  invite_url?: string;
  error?: string;
}

export interface ProvisionSummary {
  ok: boolean;
  created: boolean;
  workspace: { id: string; name: string; slug: string; locale: string };
  links: { home: string; admin: string; subdomain: string | null; instance_admin: string };
  admins: AdminInviteSummary[];
  steps: StepResult[];
  next_steps: string[];
  duration_ms: number;
}

export type ProvisionOutcome =
  | { ok: true; status: 200 | 201 | 207; summary: ProvisionSummary }
  | { ok: false; status: 409; code: string; message: string; hint?: string };

interface Actor { id: string; email: string }

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  locale: string;
  subdomain_enabled: number;
  owner_id: string;
  allowed_email_domains: string | null;
  allowed_emails: string | null;
}

const LOGO_FETCH_TIMEOUT_MS = 10_000;
const ROLE_RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 };

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

async function readWorkspace(env: Env, slug: string): Promise<WorkspaceRow | null> {
  return env.DB.prepare(
    `SELECT id, name, slug, description, locale, subdomain_enabled, owner_id, allowed_email_domains, allowed_emails
       FROM workspaces WHERE slug = ?`,
  ).bind(slug).first<WorkspaceRow>();
}

async function findOrCreateUser(env: Env, email: string): Promise<{ id: string; email: string }> {
  const existing = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first<{ id: string; email: string }>();
  if (existing) return existing;
  const id = generateId('usr');
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)').bind(id, email, email.split('@')[0] || 'there').run();
  return (await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first<{ id: string; email: string }>()) ?? { id, email };
}

/** Create the workspace, or adopt the one already on this slug. */
async function stepWorkspace(
  env: Env,
  spec: ProvisionSpec,
  executionCtx: ExecutionContext | undefined,
): Promise<{ row: WorkspaceRow; created: boolean; step: StepResult } | { conflict: { message: string; hint?: string } }> {
  let row = await readWorkspace(env, spec.slug);
  let created = false;

  if (row) {
    if (spec.if_exists === 'fail') return { conflict: { message: `Workspace slug "${spec.slug}" already exists` } };
    if (spec.if_exists === 'match' && row.name.trim().toLowerCase() !== spec.name.toLowerCase()) {
      return {
        conflict: {
          message: `Slug "${spec.slug}" belongs to the workspace "${row.name}", not "${spec.name}"`,
          hint: 'Pick another slug, or pass if_exists: "update" to adopt that workspace and apply this spec to it.',
        },
      };
    }
  } else {
    const owner = await findOrCreateUser(env, spec.owner_email);
    try {
      await createWorkspaceForUser(env, { id: owner.id, email: owner.email, username: null }, spec.name, {
        slug: spec.slug,
        description: spec.description,
        executionCtx,
      });
      created = true;
    } catch (err) {
      // Two runs racing on one slug: the loser adopts the winner's workspace.
      if (!/UNIQUE/i.test(errorMessage(err))) throw err;
    }
    row = await readWorkspace(env, spec.slug);
    if (!row) throw new Error('Workspace row missing after create');
  }

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const changed: string[] = [];
  if (!created && row.name !== spec.name) { sets.push('name = ?'); values.push(spec.name); changed.push('name'); }
  if (spec.description !== null && row.description !== spec.description) {
    sets.push('description = ?'); values.push(spec.description); changed.push('description');
  }
  if (row.locale !== spec.locale) { sets.push('locale = ?'); values.push(spec.locale); changed.push('locale'); }
  if (spec.subdomain !== null && (row.subdomain_enabled === 1) !== spec.subdomain) {
    sets.push('subdomain_enabled = ?'); values.push(spec.subdomain ? 1 : 0); changed.push('subdomain');
  }
  if (sets.length) {
    await env.DB.prepare(`UPDATE workspaces SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .bind(...values, row.id).run();
    if (changed.includes('subdomain')) await invalidateWorkspaceSlug(env, row.slug);
    row = (await readWorkspace(env, spec.slug)) ?? row;
  }

  return {
    row,
    created,
    step: {
      step: 'workspace',
      status: created ? 'created' : changed.length ? 'updated' : 'unchanged',
      detail: { id: row.id, slug: row.slug, locale: row.locale, subdomain: row.subdomain_enabled === 1, ...(changed.length && !created ? { changed } : {}) },
    },
  };
}

async function readLogo(logo: NonNullable<NonNullable<ProvisionSpec['branding']>['logo']>): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (logo.data_base64 !== undefined) {
    const bin = atob(logo.data_base64.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { bytes, contentType: logo.content_type! };
  }
  const url = logo.url!;
  const blocked = isBlockedDestination(url);
  if (blocked.blocked) throw new Error(`Logo URL refused: ${blocked.reason || 'blocked destination'}`);
  const res = await fetchCheckingRedirects(url, { method: 'GET', signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS) }, (next) =>
    next.protocol === 'https:' ? null : 'logo redirects must stay on https');
  if (!res.ok) throw new Error(`Logo URL answered ${res.status}`);
  const contentType = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType };
}

/** True when the workspace already serves exactly these logo bytes (a re-run). */
async function sameLogo(env: Env, workspaceId: string, currentExt: string | null, ext: string, bytes: Uint8Array): Promise<boolean> {
  if (!currentExt || currentExt !== ext) return false;
  const obj = await env.ARTIFACTS.get(`workspace-logos/${workspaceId}.${ext}`);
  if (!obj) return false;
  const stored = new Uint8Array(await obj.arrayBuffer());
  return stored.byteLength === bytes.byteLength && stored.every((b, i) => b === bytes[i]);
}

async function stepBranding(env: Env, ws: WorkspaceRow, spec: ProvisionSpec): Promise<StepResult> {
  const b = spec.branding;
  if (!b) return { step: 'branding', status: 'skipped' };
  const current = await loadBranding(env, ws.id);
  if (!current) throw new Error('Workspace not found');
  const before = JSON.stringify(current);
  if (b.accent_color !== undefined) current.accent_color = b.accent_color;
  if (b.hide_footer !== undefined) current.hide_footer = b.hide_footer;

  let logo: 'set' | undefined;
  if (b.logo) {
    const { bytes, contentType } = await readLogo(b.logo);
    const problem = logoProblem(contentType, bytes.byteLength);
    if (problem) throw new Error(`Logo: ${problem.error}`);
    if (!(await sameLogo(env, ws.id, current.logo_ext, logoExtFor(contentType), bytes))) {
      await storeWorkspaceLogo(env, ws.id, current, bytes, contentType);
      logo = 'set';
    } else if (JSON.stringify(current) !== before) {
      await saveBranding(env, ws.id, current);
    }
  } else if (JSON.stringify(current) !== before) {
    await saveBranding(env, ws.id, current);
  }
  const changed = logo !== undefined || JSON.stringify(current) !== before;
  return {
    step: 'branding',
    status: changed ? 'updated' : 'unchanged',
    detail: {
      accent_color: current.accent_color,
      hide_footer: current.hide_footer,
      logo_url: current.logo_ext ? `/wl/${ws.id}.${current.logo_ext}` : null,
    },
  };
}

async function stepPolicy(env: Env, ws: WorkspaceRow, spec: ProvisionSpec): Promise<StepResult> {
  const p = spec.policy;
  const changed: string[] = [];

  if (p.allowed_domains !== undefined || p.allowed_emails !== undefined) {
    const curDomains = parseJsonList(ws.allowed_email_domains);
    const curEmails = parseJsonList(ws.allowed_emails);
    const domains = p.allowed_domains ?? curDomains;
    const emails = p.allowed_emails ?? curEmails;
    if (JSON.stringify(domains) !== JSON.stringify(curDomains) || JSON.stringify(emails) !== JSON.stringify(curEmails)) {
      await env.DB.prepare("UPDATE workspaces SET allowed_email_domains = ?, allowed_emails = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .bind(domains.length ? JSON.stringify(domains) : null, emails.length ? JSON.stringify(emails) : null, ws.id).run();
      changed.push('allowed_domains');
    }
  }

  const flags: Record<string, boolean> = { ...(p.features ?? {}) };
  if (p.external_sharing !== undefined) flags['collab.external_sharing'] = p.external_sharing;
  if (Object.keys(flags).length) {
    const overrides = await getOverrides(env, ws.id);
    for (const [key, value] of Object.entries(flags)) {
      if (overrides[key] === value) continue;
      await setWorkspaceFlag(env, ws.id, key, value);
      changed.push(key);
    }
  }

  if (p.knowledge !== undefined && (await isKnowledgeEnabled(env, ws.id)) !== p.knowledge) {
    await setKnowledgeEnabled(env, ws.id, p.knowledge);
    changed.push('knowledge');
  }

  const touched = p.allowed_domains !== undefined || p.allowed_emails !== undefined || Object.keys(flags).length || p.knowledge !== undefined;
  if (!touched && p.guest_comments === undefined) return { step: 'policy', status: 'skipped' };
  return {
    step: 'policy',
    status: changed.length ? 'updated' : 'unchanged',
    detail: {
      ...(changed.length ? { changed } : {}),
      ...(p.guest_comments !== undefined ? { guest_comments: `${p.guest_comments ? 'on' : 'off'} for folders this run creates` } : {}),
    },
  };
}

async function stepFolders(env: Env, ws: WorkspaceRow, spec: ProvisionSpec): Promise<StepResult> {
  if (!spec.folders.length) return { step: 'folders', status: 'skipped' };
  const guest = spec.policy.guest_comments === true ? 1 : 0;
  const created: string[] = [];
  const existing: string[] = [];
  const seen = new Set<string>();
  for (const name of spec.folders) {
    const slug = generateFolderSlug(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    // The unique (workspace, parent, slug) index makes this safe to re-run and to race.
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO folders (id, workspace_id, name, slug, visibility, created_by, guest_comments_enabled)
       VALUES (?, ?, ?, ?, 'inherit', ?, ?)`,
    ).bind(generateId('fld'), ws.id, name, slug, ws.owner_id, guest).run();
    (res.meta?.changes ? created : existing).push(name);
  }
  return {
    step: 'folders',
    status: created.length ? 'created' : 'unchanged',
    detail: { created, existing },
  };
}

async function inviteOne(env: Env, ws: WorkspaceRow, actor: Actor, email: string, role: WorkspaceRole, resend: boolean): Promise<AdminInviteSummary> {
  const member = await env.DB.prepare(
    `SELECT wm.role, u.id AS user_id, u.last_login_at FROM workspace_members wm JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ? AND u.email = ?`,
  ).bind(ws.id, email).first<{ role: WorkspaceRole; user_id: string; last_login_at: string | null }>();

  const roleOk = member && ROLE_RANK[member.role] >= ROLE_RANK[role];
  if (member && roleOk && member.last_login_at) return { email, role: member.role, status: 'active' };
  if (member && roleOk && !resend) {
    const pending = await env.DB.prepare(
      `SELECT id FROM workspace_invite_claims
        WHERE workspace_id = ? AND user_id = ? AND claimed_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 1`,
    ).bind(ws.id, member.user_id).first();
    if (pending) return { email, role: member.role, status: 'already_invited' };
  }

  const result = await inviteOrAddMember(env, ws.id, actor.id, email, role);
  if (result.status === 'skipped') return { email, role, status: 'failed', error: result.reason || result.code };
  return {
    email,
    role: member && ROLE_RANK[member.role] > ROLE_RANK[role] ? member.role : role,
    status: result.status === 'invited' ? 'invited' : 'added',
    ...(result.email_sent === undefined ? {} : { email_sent: result.email_sent }),
    ...(result.invite_url ? { invite_url: result.invite_url } : {}),
  };
}

async function stepAdmins(env: Env, ws: WorkspaceRow, actor: Actor, spec: ProvisionSpec): Promise<{ step: StepResult; admins: AdminInviteSummary[] }> {
  const admins: AdminInviteSummary[] = [];
  for (const email of spec.admins) {
    try {
      admins.push(await inviteOne(env, ws, actor, email, 'admin', spec.resend_invites));
    } catch (err) {
      admins.push({ email, role: 'admin', status: 'failed', error: errorMessage(err) });
    }
  }
  const failed = admins.filter((a) => a.status === 'failed');
  const fresh = admins.filter((a) => a.status === 'invited' || a.status === 'added');
  return {
    admins,
    step: {
      step: 'admins',
      status: failed.length ? 'failed' : fresh.length ? 'created' : 'unchanged',
      detail: { invited: fresh.map((a) => a.email), unchanged: admins.filter((a) => a.status === 'active' || a.status === 'already_invited').map((a) => a.email) },
      ...(failed.length ? { error: failed.map((a) => `${a.email}: ${a.error}`).join('; ') } : {}),
    },
  };
}

async function stepConnectors(env: Env, ws: WorkspaceRow, actor: Actor, spec: ProvisionSpec, executionCtx?: ExecutionContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for (const c of spec.connectors) {
    const step = `connector:${c.name}`;
    const kind = c.kind === 'platform' ? { provider: c.provider } : { type: c.type };
    const existing = await env.DB.prepare("SELECT id FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND name = ?")
      .bind(ws.id, c.name).first<{ id: string }>();
    if (existing) {
      // Never overwrite a stored credential from a spec re-run: rotate it in the workspace.
      out.push({ step, status: 'unchanged', detail: { id: existing.id, ...kind } });
      continue;
    }
    const res = await createWorkspaceConnection(env, ws.id, actor, c, executionCtx);
    const body = await res.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (res.ok) out.push({ step, status: 'created', detail: { id: body.id, ...kind } });
    else out.push({ step, status: 'failed', detail: kind, error: String(body.error || `HTTP ${res.status}`) });
  }
  return out;
}

async function stepHook(name: ProvisionHookName, value: string | null, env: Env, ws: WorkspaceRow, actor: Actor, executionCtx?: ExecutionContext): Promise<StepResult | null> {
  if (value === null) return null;
  const hook = getProvisionHook(name) ?? BUILTIN_PROVISION_HOOKS[name];
  const r = await hook({ env, workspace: { id: ws.id, slug: ws.slug, name: ws.name }, actor, executionCtx }, value);
  return { step: name, status: r.status, detail: { value, ...(r.detail ?? {}) }, ...(r.next_step ? { next_step: r.next_step } : {}) };
}

async function guarded(step: string, fn: () => Promise<StepResult | null>): Promise<StepResult | null> {
  try {
    return await fn();
  } catch (err) {
    return { step, status: 'failed', error: errorMessage(err) };
  }
}

function auditStep(env: Env, ws: WorkspaceRow, actor: Actor, s: StepResult): Promise<void> {
  return logAudit(env, {
    workspaceId: ws.id,
    actorId: actor.id,
    actorEmail: actor.email,
    action: `workspace.provision.${s.step.split(':')[0]}`,
    targetType: 'workspace',
    targetId: ws.id,
    // Step details are built from names, ids and flags only — never credential values.
    detail: { step: s.step, status: s.status, ...(s.detail ?? {}), ...(s.error ? { error: s.error } : {}) },
  });
}

function nextSteps(summary: Omit<ProvisionSummary, 'next_steps' | 'duration_ms'>): string[] {
  const out: string[] = [];
  for (const a of summary.admins) {
    if (a.status === 'invited' && a.email_sent === false && a.invite_url) out.push(`Send ${a.email} their join link by hand: ${a.invite_url}`);
    if (a.status === 'failed') out.push(`Invite ${a.email} again after fixing: ${a.error}`);
  }
  for (const s of summary.steps) {
    if (s.status === 'failed') out.push(`Fix ${s.step} (${s.error}) and re-run the same spec — finished steps are left alone.`);
    if (s.status === 'pending' && s.next_step) out.push(s.next_step);
  }
  if (summary.links.subdomain === null) out.push('Turn on the subdomain (subdomain: true) if the customer should sign in at their own address.');
  if (!out.length) out.push('Nothing left to do — the admins can sign in.');
  return out;
}

export async function runProvisioning(
  env: Env,
  actor: Actor,
  spec: ProvisionSpec,
  executionCtx?: ExecutionContext,
): Promise<ProvisionOutcome> {
  const started = Date.now();
  const ws = await stepWorkspace(env, spec, executionCtx);
  if ('conflict' in ws) return { ok: false, status: 409, code: 'SLUG_TAKEN', message: ws.conflict.message, hint: ws.conflict.hint };
  const { row, created } = ws;

  const steps: StepResult[] = [ws.step];
  const push = (s: StepResult | null) => { if (s) steps.push(s); };

  push(await guarded('branding', () => stepBranding(env, row, spec)));
  push(await guarded('policy', () => stepPolicy(env, row, spec)));
  push(await guarded('folders', () => stepFolders(env, row, spec)));
  const invites = await stepAdmins(env, row, actor, spec);
  push(invites.step);
  for (const s of await stepConnectors(env, row, actor, spec, executionCtx).catch((err) => [{ step: 'connectors', status: 'failed' as const, error: errorMessage(err) }])) push(s);
  push(await guarded('custom_domain', () => stepHook('custom_domain', spec.custom_domain, env, row, actor, executionCtx)));

  await Promise.all(steps.map((s) => auditStep(env, row, actor, s)));

  const origin = getPlatformOrigin(env);
  const partial = steps.some((s) => s.status === 'failed');
  const base = {
    ok: !partial,
    created,
    workspace: { id: row.id, name: row.name, slug: row.slug, locale: row.locale },
    links: {
      home: `${origin}/home?workspace=${encodeURIComponent(row.id)}`,
      admin: `${origin}/home?workspace=${encodeURIComponent(row.id)}#l/admin`,
      subdomain: row.subdomain_enabled === 1 ? `${origin.replace(/^(https?:\/\/).*$/, '$1')}${row.slug}.${getPlatformHostname(env)}/` : null,
      instance_admin: `${origin}/admin`,
    },
    admins: invites.admins,
    steps,
  };
  const summary: ProvisionSummary = { ...base, next_steps: nextSteps(base), duration_ms: Date.now() - started };

  await logAudit(env, {
    workspaceId: row.id,
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'workspace.provision',
    targetType: 'workspace',
    targetId: row.id,
    detail: { slug: row.slug, created, partial, failed: steps.filter((s) => s.status === 'failed').map((s) => s.step), duration_ms: summary.duration_ms },
  });

  return { ok: true, status: partial ? 207 : created ? 201 : 200, summary };
}
