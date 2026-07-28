/**
 * Shared types for the authenticated home page (/home).
 * Artifact rows mirror D1 query projections; RenderArgs bundles SSR props.
 */
export interface ArtifactRow {
  id: string;
  name: string;
  slug: string;
  display_slug: string;
  description: string | null;
  artifact_type: string;
  visibility: string;
  workspace_id: string | null;
  created_at: string;
  updated_at: string | null;
  user_role: string;
  owner_name: string | null;
  owner_picture: string | null;
  total_views: number;
  unique_visitors: number;
  is_favorite: number;
  f_blobs: number;
  f_datasets: number;
  f_connections: number;
  f_platform: number;
  f_jobs: number;
  f_agent: number;
  f_tests: number;
  f_skills: number;
  tags: string | null;
  folder_id: string | null;
  is_example: number;
  moderation_status: string | null;
  moderation_held_visibility: string | null;
}

export interface HomeFolder {
  id: string;
  name: string;
  artifact_count: number;
}

export interface HomeTag {
  label: string;
  count: number;
}

export type HomeFilesScope = 'team' | 'personal';

export interface HomeFilters {
  page: number;
  search: string;
  sort: string;
  type: string;
  scope: string;
  workspace: string;
  folder: string;
  /** Which artifact set is active when browsing a workspace (team vs your private files). */
  filesScope: HomeFilesScope;
  /** Which folder list is open when drilling into a folder. */
  folderKind: HomeFilesScope | '';
}

export interface RenderArgs {
  user: { id: string; email: string | null };
  userInfo: { name: string | null; picture: string | null } | null;
  catalog: ArtifactRow[];
  catalogTruncated: boolean;
  catalogTotal: number;
  allCount: number;
  favCount: number;
  sharedCount: number;
  workspaces: Array<{ id: string; name: string; slug: string; branding?: string | null; artifact_count: number; can_manage?: boolean }>;
  folders: HomeFolder[];
  teamFolders: HomeFolder[];
  personalFolders: HomeFolder[];
  filesScope: HomeFilesScope;
  folderKind: HomeFilesScope | '';
  tags: HomeTag[];
  search: string;
  folder: string;
  sort: string;
  type: string;
  scope: string;
  workspace: string;
  page: number;
  openVisDisabled: boolean;
  workspaceId: string | null;
  workspaceRole: string | null;
  /** Workspace owner is on a Teams/Enterprise plan → Skill Marketplace is available. */
  wsTeamsPlan: boolean;
  /** Workspace owner is on a paid tier (Pro+) → Knowledge lens shows the enable flow, not the upsell. */
  wsKnowledgePaid: boolean;
  /** Domain inbound file inboxes actually receive on, derived from this instance.
   *  Empty when no email binding exists — the Settings tab then hides the address
   *  instead of printing one that cannot receive. */
  inboxDomain: string;
  /** Viewer administers the instance itself → Settings links to the admin portal. */
  isInstanceAdmin: boolean;
  hostname: string;
  /** Short current-release id (Cloudflare deployment version) for the rail footer; '' when unavailable. */
  appVersion: string;
  visualEditorOffWorkspaces: string[];
  /** Whether the /create AI chat flow is enabled for the current workspace context. */
  createEnabled: boolean;
  accessRequests: Array<{
    id: string;
    artifact_id: string;
    artifact_name: string;
    artifact_slug: string;
    requester_email: string;
    requester_name: string | null;
    created_at: string;
  }>;
}

/** A recent view event, shown in the (lazy-loaded) Activity panel. */
export interface RecentActivityRow {
  artifact_name: string;
  slug: string;
  event_type: string;
  timestamp: string;
  country: string | null;
}

/** A recent comment across the user's artifacts, shown in the Conversations panel. */
export interface RecentCommentRow {
  artifact_name: string;
  slug: string;
  author_name: string;
  content: string;
  created_at: string;
  resolved: number;
}

/** Kinds of workspace activity surfaced in the feed. Registry lives in ./events. */
export type { ActivityKind, EventAudience, EventTier, AudienceMap } from './events';
import type { ActivityKind } from './events';

/** Pulse aggregation window. */
export type PulseWindow = 'today' | '7d' | '30d';

/**
 * One ACTIONABLE event in the "Needs You" surface — individual, never aggregated.
 * `ts` is unix SECONDS so TEXT-datetime and INTEGER-epoch source rows sort together.
 * Artifact fields are nullable: workspace-level events (member joins, agent runs)
 * have no artifact.
 */
export interface ActivityEvent {
  kind: ActivityKind;
  /** Stable id of the underlying row (for client dedupe / keys). */
  id: string;
  artifact_id: string | null;
  artifact_name: string | null;
  slug: string | null;
  /** Who acted (comment author, sharer, etc.); null for system/anon events. */
  actor: string | null;
  actor_picture: string | null;
  /** Short human summary, e.g. "commented", "scheduled email · success". */
  summary: string;
  ts: number;
  /** Aggregated count for workspace-level cards (e.g. unused-pages count). */
  count?: number;
  /** Workspace id for workspace-level actionable cards that carry a bulk action. */
  workspaceId?: string | null;
}

/**
 * One AMBIENT, AGGREGATED row in the "Pulse" surface. A single PulseEvent collapses
 * N raw events of one kind on one artifact (or one workspace-level bucket) within
 * the window into a count — this is what keeps the feed meaningful at team scale.
 */
export interface PulseEvent {
  kind: ActivityKind;
  /** Aggregation key: `${kind}:${artifact_id ?? 'ws'}`. */
  id: string;
  artifact_id: string | null;
  artifact_name: string | null;
  slug: string | null;
  /** How many raw events this row represents within the window. */
  count: number;
  /** Human summary, e.g. "3 updates published", "+18 views", "5 people joined". */
  summary: string;
  /** Most recent raw event ts (unix seconds) — used to sort the Pulse. */
  ts: number;
}

/**
 * One "action item" — a comment assigned to me (open, actionable via Done), or a
 * comment I delegated that was just completed (closed, actionable via Reopen).
 * `ts` is unix SECONDS (created_at), sorted after due_at.
 */
export interface ActionItem {
  id: string;
  artifact_id: string;
  artifact_name: string | null;
  slug: string | null;
  /** Comment author = who requested the work. */
  actor: string | null;
  /** Trimmed comment body. */
  summary: string;
  due_at: string | null;
  ts: number;
  resolved: number;
  resolved_by: string | null;
  resolved_at: string | null;
}

/** The full activity payload: actionable rows + aggregated ambient rows. */
export interface ActivityFeed {
  needs: ActivityEvent[];
  /** Needs-you events this user already dismissed/opened, for the "Seen" tab. */
  seen: ActivityEvent[];
  pulse: PulseEvent[];
  window: PulseWindow;
  /** Cross-artifact "My action items" inbox (assigned to me + my just-completed delegations). */
  actionItems: ActionItem[];
  /** Count of my outstanding delegations (comments I authored with an unresolved assignee). */
  requestedOpen: number;
}
