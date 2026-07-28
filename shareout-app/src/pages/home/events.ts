/**
 * Activity-event taxonomy + visibility resolution.
 *
 * Two design axes keep the feed meaningful at 500-person + agent scale:
 *  1. TIER — actionable events become individual rows ("Needs You"); ambient
 *     events only ever exist as aggregated counts ("Pulse"). Adding raw event
 *     kinds to a reverse-chron firehose destroys signal; aggregation preserves it.
 *  2. AUDIENCE — privacy-first defaults gate who sees each kind (self / members /
 *     admins). Admins override per-workspace via `workspace_event_visibility`
 *     (Teams/Enterprise that want less transparency downgrade or turn kinds off).
 */
import type { Env } from '../../types';
import type { WorkspaceRole } from '../../types';

export type ActivityKind =
  | 'comment' | 'reply' | 'mention' | 'share' | 'access' | 'alert' | 'test' | 'file' | 'stale_data' | 'metric_watch' | 'unused_artifacts' | 'moderation'  // actionable
  | 'run' | 'publish' | 'create' | 'favorite' | 'view'
  | 'connection' | 'skill' | 'member' | 'agent';                  // ambient

export type EventTier = 'actionable' | 'ambient';
/** 'off' = nobody (kind suppressed in this workspace). */
export type EventAudience = 'self' | 'members' | 'admins' | 'off';

export interface EventDef {
  tier: EventTier;
  /** Built-in privacy-first default; overridable per workspace. */
  defaultAudience: Exclude<EventAudience, 'off'>;
  /** Admin-facing label in the visibility settings panel. */
  label: string;
  /** One-line description of what the kind surfaces. */
  hint: string;
}

/**
 * The registry. `tier` decides Needs You (actionable, one row each) vs Pulse
 * (ambient, aggregated). Note: a failed `run`/`test` is promoted to Needs You at
 * query time even though its default surface is the Pulse — failures need you.
 */
export const EVENT_DEFS: Record<ActivityKind, EventDef> = {
  comment:    { tier: 'actionable', defaultAudience: 'members', label: 'Comments',          hint: 'Comments on artifacts' },
  reply:      { tier: 'actionable', defaultAudience: 'members', label: 'Replies',           hint: 'Replies in comment threads' },
  // Directed AT you, so it defaults to 'self' and stays visible even when the broader
  // comment/reply kinds are turned down — being named is not ambient chatter.
  mention:    { tier: 'actionable', defaultAudience: 'self',    label: 'Mentions',          hint: 'Comments that @mention you' },
  share:      { tier: 'actionable', defaultAudience: 'self',    label: 'Shares to you',     hint: 'Artifacts shared directly with a person' },
  access:     { tier: 'actionable', defaultAudience: 'admins',  label: 'Access requests',   hint: 'Requests to view a private artifact' },
  alert:      { tier: 'actionable', defaultAudience: 'members', label: 'Metric alerts',     hint: 'Metric-alert triggers' },
  test:       { tier: 'actionable', defaultAudience: 'members', label: 'Test results',      hint: 'Artifact safety-net test runs' },
  file:       { tier: 'actionable', defaultAudience: 'admins',  label: 'Files emailed in',  hint: 'Spreadsheets and files members forward to the workspace inbox' },
  stale_data: { tier: 'actionable', defaultAudience: 'members', label: 'Stale data',        hint: 'Dashboard data sources that have gone quiet' },
  metric_watch:{ tier: 'actionable', defaultAudience: 'members', label: 'Metric watch',      hint: 'Watched metrics that moved sharply' },
  unused_artifacts:{ tier: 'actionable', defaultAudience: 'admins', label: 'Unused pages',    hint: 'Published pages nobody has opened in 90+ days' },
  moderation:  { tier: 'actionable', defaultAudience: 'self',    label: 'Safety review',     hint: 'When a held page passes review or gets blocked' },
  run:        { tier: 'ambient',    defaultAudience: 'members', label: 'Job & crew runs',   hint: 'Scheduled job and crew executions' },
  publish:    { tier: 'ambient',    defaultAudience: 'members', label: 'Publishes',         hint: 'New versions published' },
  create:     { tier: 'ambient',    defaultAudience: 'members', label: 'New artifacts',     hint: 'Artifacts created' },
  favorite:   { tier: 'ambient',    defaultAudience: 'self',    label: 'Favorites',         hint: 'Who starred an artifact' },
  view:       { tier: 'ambient',    defaultAudience: 'self',    label: 'Views',             hint: 'Artifact page views' },
  connection: { tier: 'ambient',    defaultAudience: 'admins',  label: 'Data connections',  hint: 'Data sources & connectors wired up' },
  skill:      { tier: 'ambient',    defaultAudience: 'members', label: 'Skills attached',   hint: 'Skills attached to artifacts' },
  member:     { tier: 'ambient',    defaultAudience: 'admins',  label: 'Member joins',      hint: 'People joining the workspace' },
  agent:      { tier: 'ambient',    defaultAudience: 'self',    label: 'AI assistant',      hint: 'Workspace AI assistant activity' },
};

export const ALL_KINDS = Object.keys(EVENT_DEFS) as ActivityKind[];

const AUDIENCES: EventAudience[] = ['self', 'members', 'admins', 'off'];
export function isAudience(v: unknown): v is EventAudience {
  return typeof v === 'string' && (AUDIENCES as string[]).includes(v);
}

export type AudienceMap = Record<ActivityKind, EventAudience>;

/** Built-in defaults as a full map (no overrides). */
export function defaultAudiences(): AudienceMap {
  const m = {} as AudienceMap;
  for (const k of ALL_KINDS) m[k] = EVENT_DEFS[k].defaultAudience;
  return m;
}

/**
 * Effective audience per kind for a workspace = defaults with admin overrides
 * applied. Personal scope (no workspace) has no overrides → pure defaults.
 */
export async function resolveWorkspaceAudiences(
  env: Env,
  workspaceId: string | null,
): Promise<AudienceMap> {
  const map = defaultAudiences();
  if (!workspaceId) return map;
  const rows = await env.DB.prepare(
    'SELECT event_kind, audience FROM workspace_event_visibility WHERE workspace_id = ?',
  ).bind(workspaceId).all<{ event_kind: string; audience: string }>();
  for (const r of rows.results || []) {
    if (r.event_kind in EVENT_DEFS && isAudience(r.audience)) {
      map[r.event_kind as ActivityKind] = r.audience;
    }
  }
  return map;
}

/** Upsert one admin override. Storing the default value is fine (idempotent). */
export async function setWorkspaceEventAudience(
  env: Env,
  workspaceId: string,
  kind: ActivityKind,
  audience: EventAudience,
  userId: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace_event_visibility (workspace_id, event_kind, audience, updated_at, updated_by)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)
     ON CONFLICT(workspace_id, event_kind) DO UPDATE SET audience = excluded.audience, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = excluded.updated_by`,
  ).bind(workspaceId, kind, audience, userId).run();
}

const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 3, admin: 2, member: 1 };
function isAdminRole(role: WorkspaceRole | null): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK.admin;
}

/**
 * Can a viewer with `role` see an event of `audience`?
 * `isOwn` = the event is the viewer's own action or about an artifact they own —
 * such events always pass (you can always see your own activity, even at 'self').
 * Personal scope: role is null but isOwn is true, so personal events pass.
 */
export function canRoleSee(audience: EventAudience, role: WorkspaceRole | null, isOwn: boolean): boolean {
  if (isOwn) return audience !== 'off';
  switch (audience) {
    case 'off':     return false;
    case 'self':    return false;        // not own → hidden
    case 'members': return role !== null; // any workspace member
    case 'admins':  return isAdminRole(role);
  }
}

