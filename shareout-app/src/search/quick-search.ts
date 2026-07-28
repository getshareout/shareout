import type { Env } from '../types';
import { placeholders } from '../account-links';
import {
  getBotVisibilityScope,
  listWorkspacesForUser,
  TELEGRAM_PERSONAL_WORKSPACE,
  type WorkspaceSelection,
} from '../chat-agent/access';

/**
 * Shared "pro search" service — one ranked, fuzzy, multi-group search behind every
 * surface (Cmd+K palette, inline home dropdown, the /v1/search agent endpoint, and
 * the search_workspace chat tool). Keep the scorer pure so it can be unit-tested and
 * so all callers rank identically.
 */

export type SearchGroup =
  | 'artifacts'
  | 'folders'
  | 'datasets'
  | 'connectors'
  | 'people'
  | 'schedules'
  | 'crew'
  | 'alerts';

export interface SearchHit {
  kind: 'artifact' | 'folder' | 'dataset' | 'connector' | 'person' | 'schedule' | 'crew' | 'alert';
  id: string;
  title: string;
  subtitle?: string; // location / provider / owner — the dim second line
  slug?: string; // artifacts: canonical /a/<slug>/ ; folders: drill-in id
  artifactType?: string;
  thumb?: string; // artifact preview image (R2 thumbnail) when available
  avatar?: string; // owner / person picture URL
  owner?: string; // owner display name (artifacts)
  views?: number; // lifetime views (artifacts)
  badge?: string; // small status pill — 'Private', 'Paused', 'Failing'…
  score: number;
}

export interface QuickSearchResult {
  query: string;
  artifacts: SearchHit[];
  folders: SearchHit[];
  datasets: SearchHit[];
  connectors: SearchHit[];
  people: SearchHit[];
  schedules: SearchHit[];
  crew: SearchHit[];
  alerts: SearchHit[];
}

// ---------- fuzzy scoring (pure) ----------

const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Lowercase, strip accents, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how well `query` matches `text`. 0 = no match, 1 = exact.
 * Tiers: exact > prefix > word-boundary substring > substring > every-token substring
 * > in-order subsequence (typo/gap tolerant). Higher tiers always beat lower ones.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (!q || !t) return 0;
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.92;

  const idx = t.indexOf(q);
  if (idx >= 0) {
    const wordStart = idx === 0 || t[idx - 1] === ' ';
    const positional = 1 - idx / t.length; // earlier = better
    return (wordStart ? 0.78 : 0.62) + 0.1 * positional;
  }

  // Every whitespace token appears somewhere (order-independent) → strong AND match.
  const tokens = q.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens.every((tok) => t.includes(tok))) {
    return 0.6;
  }

  // In-order subsequence — tolerates typos/gaps ("revnue" → "revenue").
  const sub = subsequenceScore(q, t);
  if (sub > 0) return 0.25 + 0.25 * sub;

  return 0;
}

/** Fraction 0..1 of how tightly `q`'s chars appear in order within `t` (0 = not a subsequence). */
function subsequenceScore(q: string, t: string): number {
  let ti = 0;
  let firstHit = -1;
  let lastHit = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    if (c === ' ') continue;
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === c) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found < 0) return 0; // not a subsequence
    if (firstHit < 0) firstHit = found;
    lastHit = found;
  }
  const span = lastHit - firstHit + 1;
  if (span <= 0) return 0;
  const compact = q.replace(/\s/g, '').length / span; // 1 = contiguous
  return Math.max(0, Math.min(1, compact));
}

/** Recency nudge (updated within ~90d) — never overrides a real text match. */
function boost(updatedAt: string | number | null): number {
  if (updatedAt == null) return 0;
  const ts = typeof updatedAt === 'number' ? updatedAt * 1000 : Date.parse(updatedAt);
  if (Number.isNaN(ts)) return 0;
  const days = (Date.now() - ts) / 86_400_000;
  return days <= 90 ? 0.06 * (1 - days / 90) : 0;
}

// ---------- candidate fetch + ranking ----------

interface ArtifactCandidate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  artifact_type: string | null;
  updated_at: string | null;
  tags: string | null; // newline-joined labels
  visibility: string | null;
  thumbnail_ext: string | null;
  views: number | null;
  owner_name: string | null;
  owner_picture: string | null;
}

const RECENT_LIMIT = 300; // most-recent slice — fuzzy/typo tolerance runs over this
const LIKE_LIMIT = 150; // extra substring matches beyond the recent window (old exact hits)

/**
 * Pull a candidate pool the user can see, then rank in JS. The recent slice is ALWAYS
 * fetched unfiltered so typo/subsequence matches work ("revnue" → "Revenue"); when `q`
 * is set we additionally union broad LIKE matches so an exact substring hit older than
 * the recent window still surfaces. Merged + de-duped by id.
 */
async function artifactCandidates(
  env: Env,
  userId: string,
  workspaceId: WorkspaceSelection | undefined,
  q: string,
): Promise<ArtifactCandidate[]> {
  const scope = await getBotVisibilityScope(env, userId);
  const idPh = placeholders(scope.userIds.length);
  const emailPh = placeholders(scope.emails.length);

  let scopeClause: string;
  let scopeBinds: unknown[];
  if (workspaceId === TELEGRAM_PERSONAL_WORKSPACE) {
    scopeClause = `a.workspace_id IS NULL AND (a.owner_id IN (${idPh}) OR c.email IN (${emailPh}))`;
    scopeBinds = [...scope.userIds, ...scope.emails];
  } else if (workspaceId) {
    const workspaces = await listWorkspacesForUser(env, userId);
    if (!workspaces.some((w) => w.id === workspaceId)) return [];
    scopeClause = `a.workspace_id = ? AND (a.visibility != 'private' OR a.owner_id IN (${idPh}) OR c.email IN (${emailPh}))`;
    scopeBinds = [workspaceId, ...scope.userIds, ...scope.emails];
  } else {
    const wsIds = (await listWorkspacesForUser(env, userId)).map((w) => w.id);
    const wsClause = wsIds.length
      ? ` OR (a.visibility = 'workspace' AND a.workspace_id IN (${placeholders(wsIds.length)}))`
      : '';
    scopeClause = `(a.owner_id IN (${idPh}) OR c.email IN (${emailPh})${wsClause})`;
    scopeBinds = [...scope.userIds, ...scope.emails, ...(wsIds as string[])];
  }

  const select = (extraWhere: string, limit: number) => `
    SELECT a.id, a.name, COALESCE(d.slug, a.slug) AS slug, a.description, a.artifact_type,
      COALESCE(d.updated_at, a.created_at) AS updated_at,
      a.visibility AS visibility, pres_a.thumbnail_ext AS thumbnail_ext,
      COALESCE(avt.views, 0) AS views,
      (SELECT name FROM users u WHERE u.id = a.owner_id) AS owner_name,
      (SELECT picture FROM users u WHERE u.id = a.owner_id) AS owner_picture,
      (SELECT GROUP_CONCAT(t.label, char(10)) FROM artifact_tags t WHERE t.artifact_id = a.id) AS tags
    FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    LEFT JOIN artifact_view_totals avt ON avt.artifact_id = a.id
    LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
    LEFT JOIN collaborators c ON c.artifact_id = a.id AND c.email IN (${emailPh})
    WHERE (${scopeClause})${extraWhere}
    GROUP BY a.id
    ORDER BY COALESCE(d.updated_at, a.created_at) DESC
    LIMIT ?`;

  const recentP = env.DB.prepare(select('', RECENT_LIMIT))
    .bind(...scope.emails, ...scopeBinds, RECENT_LIMIT)
    .all<ArtifactCandidate>();

  const likeP = q
    ? env.DB.prepare(select(
        ` AND (a.name LIKE ? OR a.slug LIKE ? OR a.description LIKE ? OR EXISTS (SELECT 1 FROM artifact_tags at2 WHERE at2.artifact_id = a.id AND at2.label LIKE ?))`,
        LIKE_LIMIT,
      )).bind(...scope.emails, ...scopeBinds, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, LIKE_LIMIT)
        .all<ArtifactCandidate>()
    : Promise.resolve({ results: [] as ArtifactCandidate[] });

  const [recent, like] = await Promise.all([recentP, likeP]);
  const byId = new Map<string, ArtifactCandidate>();
  for (const r of recent.results) byId.set(r.id, r);
  for (const r of like.results) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()];
}

/** Build an enriched artifact hit — preview thumbnail, owner avatar, and view count. */
function artifactHit(r: ArtifactCandidate, score: number): SearchHit {
  const ver = r.updated_at ? '?v=' + encodeURIComponent(r.updated_at) : '';
  return {
    kind: 'artifact',
    id: r.id,
    title: r.name,
    slug: r.slug,
    artifactType: r.artifact_type || 'html',
    subtitle: r.description || undefined,
    thumb: r.thumbnail_ext ? `/t/${r.id}_card.webp${ver}` : undefined,
    avatar: r.owner_picture || undefined,
    owner: r.owner_name || undefined,
    views: r.views != null ? r.views : undefined,
    badge: r.visibility === 'private' ? 'Private' : undefined,
    score,
  };
}

function rankArtifacts(rows: ArtifactCandidate[], q: string, limit: number): SearchHit[] {
  if (!q) return rows.slice(0, limit).map((r) => artifactHit(r, 0));
  const scored: SearchHit[] = [];
  for (const r of rows) {
    const nameS = fuzzyScore(q, r.name) * 1.0;
    const tagS = r.tags ? fuzzyScore(q, r.tags.replace(/\n/g, ' ')) * 0.65 : 0;
    const descS = r.description ? fuzzyScore(q, r.description) * 0.45 : 0;
    const base = Math.max(nameS, tagS, descS);
    if (base <= 0) continue;
    scored.push(artifactHit(r, base + boost(r.updated_at)));
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

async function rankFolders(env: Env, workspaceId: string, q: string, limit: number): Promise<SearchHit[]> {
  const res = await env.DB.prepare(
    `SELECT f.id, f.name, (SELECT COUNT(*) FROM artifacts a WHERE a.folder_id = f.id) AS n
     FROM folders f WHERE f.workspace_id = ? AND f.parent_id IS NULL`
  ).bind(workspaceId).all<{ id: string; name: string; n: number }>();
  return rankSimple(res.results.map((r) => ({ id: r.id, title: r.name, subtitle: `${r.n} page${r.n === 1 ? '' : 's'}` })), 'folder', q, limit);
}

async function rankDatasets(env: Env, workspaceId: string, q: string, limit: number): Promise<SearchHit[]> {
  const res = await env.DB.prepare(
    `SELECT shared_name, source_table_name, access FROM workspace_shared_tables WHERE workspace_id = ?`
  ).bind(workspaceId).all<{ shared_name: string; source_table_name: string; access: string }>();
  return rankSimple(
    res.results.map((r) => ({ id: r.shared_name, title: r.shared_name, subtitle: r.access === 'readwrite' ? 'read/write' : 'read' })),
    'dataset', q, limit,
  );
}

async function rankConnectors(env: Env, workspaceId: string, q: string, limit: number): Promise<SearchHit[]> {
  const res = await env.DB.prepare(
    `SELECT id, name, provider, kind FROM connections WHERE scope_type = 'workspace' AND scope_id = ?`
  ).bind(workspaceId).all<{ id: string; name: string; provider: string; kind: string }>();
  return rankSimple(
    res.results.map((r) => ({ id: r.id, title: r.name, subtitle: r.provider })),
    'connector', q, limit,
  );
}

interface SimpleItem {
  id: string;
  title: string;
  subtitle?: string;
  avatar?: string;
  badge?: string;
  extra?: string; // extra searchable text (email, provider…) not shown
}

function rankSimple(items: SimpleItem[], kind: SearchHit['kind'], q: string, limit: number): SearchHit[] {
  const make = (i: SimpleItem, score: number): SearchHit => ({
    kind,
    id: i.id,
    title: i.title,
    subtitle: i.subtitle,
    avatar: i.avatar,
    badge: i.badge,
    score,
  });
  if (!q) return items.slice(0, limit).map((i) => make(i, 0));
  const scored: SearchHit[] = [];
  for (const i of items) {
    const s = Math.max(fuzzyScore(q, i.title), i.extra ? fuzzyScore(q, i.extra) * 0.8 : 0);
    if (s <= 0) continue;
    scored.push(make(i, s));
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

async function rankPeople(env: Env, workspaceId: string, q: string, limit: number): Promise<SearchHit[]> {
  const res = await env.DB.prepare(
    `SELECT m.user_id, m.role, u.name, u.email, u.picture
     FROM workspace_members m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ?`
  ).bind(workspaceId).all<{ user_id: string; role: string; name: string | null; email: string | null; picture: string | null }>();
  return rankSimple(
    res.results.map((r) => ({
      id: r.user_id,
      title: r.name || r.email || 'Member',
      subtitle: [cap(r.role), r.email && r.email !== r.name ? r.email : ''].filter(Boolean).join(' · '),
      avatar: r.picture || undefined,
      extra: r.email || undefined,
    })),
    'person', q, limit,
  );
}

/** Scope for the personal-capable groups: a workspace, or the user's own owner ids. */
type OwnerScope = { wsId: string | null; ownerIds: string[] };

async function rankSchedules(env: Env, scope: OwnerScope, q: string, limit: number): Promise<SearchHit[]> {
  const where = scope.wsId ? 'a.workspace_id = ?' : `s.owner_id IN (${placeholders(scope.ownerIds.length)})`;
  const binds = scope.wsId ? [scope.wsId] : scope.ownerIds;
  if (!scope.wsId && !scope.ownerIds.length) return [];
  const res = await env.DB.prepare(
    `SELECT s.id, s.action, s.schedule, s.enabled, s.last_status, a.name AS art_name
     FROM scheduled_jobs s JOIN artifacts a ON a.id = s.artifact_id
     WHERE ${where} ORDER BY s.enabled DESC, s.next_run_at ASC LIMIT 200`
  ).bind(...binds).all<{ id: string; action: string; schedule: string; enabled: number; last_status: string | null; art_name: string }>();
  return rankSimple(
    res.results.map((r) => ({
      id: r.id,
      title: r.art_name,
      subtitle: [prettyAction(r.action), r.schedule].filter(Boolean).join(' · '),
      badge: !r.enabled ? 'Paused' : r.last_status === 'failed' ? 'Failing' : undefined,
      extra: r.action,
    })),
    'schedule', q, limit,
  );
}

async function rankCrews(env: Env, workspaceId: string, q: string, limit: number): Promise<SearchHit[]> {
  const res = await env.DB.prepare(
    `SELECT id, name, status FROM crews WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200`
  ).bind(workspaceId).all<{ id: string; name: string; status: string | null }>();
  return rankSimple(
    res.results.map((r) => ({
      id: r.id,
      title: r.name,
      subtitle: cap(r.status || 'active') + ' crew',
      badge: r.status && r.status !== 'active' ? cap(r.status) : undefined,
    })),
    'crew', q, limit,
  );
}

async function rankAlerts(env: Env, scope: OwnerScope, q: string, limit: number): Promise<SearchHit[]> {
  const where = scope.wsId ? 'workspace_id = ?' : `owner_id IN (${placeholders(scope.ownerIds.length)})`;
  const binds = scope.wsId ? [scope.wsId] : scope.ownerIds;
  if (!scope.wsId && !scope.ownerIds.length) return [];
  const res = await env.DB.prepare(
    `SELECT id, name, destination_kind, enabled, last_status FROM metric_alert_rules WHERE ${where} ORDER BY created_at DESC LIMIT 200`
  ).bind(...binds).all<{ id: string; name: string; destination_kind: string; enabled: number; last_status: string | null }>();
  return rankSimple(
    res.results.map((r) => ({
      id: r.id,
      title: r.name,
      subtitle: 'Alert · ' + r.destination_kind,
      badge: !r.enabled ? 'Paused' : r.last_status === 'failed' ? 'Failing' : r.last_status === 'matched' ? 'Triggered' : undefined,
    })),
    'alert', q, limit,
  );
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function prettyAction(action: string): string {
  const map: Record<string, string> = {
    email: 'Email report',
    webhook: 'Webhook',
    query_snapshot: 'Query snapshot',
    sheets_append: 'Sheets append',
    materialize: 'Materialize',
    artifact_test: 'Test run',
  };
  return map[action] || cap(action.replace(/_/g, ' '));
}

export interface QuickSearchOpts {
  q: string;
  workspaceId?: WorkspaceSelection;
  groups?: SearchGroup[];
  limit?: number;
}

/** Run the ranked multi-group search. `workspaceId` unset → search across everything the user can see. */
export async function quickSearch(env: Env, userId: string, opts: QuickSearchOpts): Promise<QuickSearchResult> {
  const q = (opts.q || '').trim();
  const limit = opts.limit ?? 8;
  const groups = new Set(
    opts.groups ?? ['artifacts', 'folders', 'datasets', 'connectors', 'people', 'schedules', 'crew', 'alerts'],
  );
  // folders/datasets/connectors/crew/people need a concrete workspace; schedules/alerts
  // also work personally (scoped to the user's own owner ids).
  const wsId = typeof opts.workspaceId === 'string' && opts.workspaceId !== TELEGRAM_PERSONAL_WORKSPACE ? opts.workspaceId : null;
  const inWs = <T>(g: SearchGroup, run: () => Promise<T[]>): Promise<T[]> =>
    groups.has(g) && wsId ? run() : Promise.resolve([]);
  const needOwner = !wsId && (groups.has('schedules') || groups.has('alerts'));
  const ownerIds = needOwner ? (await getBotVisibilityScope(env, userId)).userIds : [];
  const ownerScope: OwnerScope = { wsId, ownerIds };
  const withOwner = (g: SearchGroup, run: () => Promise<SearchHit[]>): Promise<SearchHit[]> =>
    groups.has(g) && (wsId || ownerIds.length) ? run() : Promise.resolve([]);

  const [artifacts, folders, datasets, connectors, people, schedules, crew, alerts] = await Promise.all([
    groups.has('artifacts') ? artifactCandidates(env, userId, opts.workspaceId, q).then((rows) => rankArtifacts(rows, q, limit)) : Promise.resolve([]),
    inWs('folders', () => rankFolders(env, wsId!, q, limit)),
    inWs('datasets', () => rankDatasets(env, wsId!, q, limit)),
    inWs('connectors', () => rankConnectors(env, wsId!, q, limit)),
    inWs('people', () => rankPeople(env, wsId!, q, limit)),
    withOwner('schedules', () => rankSchedules(env, ownerScope, q, limit)),
    inWs('crew', () => rankCrews(env, wsId!, q, limit)),
    withOwner('alerts', () => rankAlerts(env, ownerScope, q, limit)),
  ]);

  return { query: q, artifacts, folders, datasets, connectors, people, schedules, crew, alerts };
}
