import type { Env } from '../types';
import type { WorkspaceSelection } from '../chat-platforms/types';
import { TELEGRAM_PERSONAL_WORKSPACE } from '../chat-agent/access';
import { artifactScopeSql, concreteWorkspace, isMemberSql, linkedIds, memberWorkspacesSql } from './scope-sql';

/**
 * The palette's local search index: a compact list of everything the user can find by
 * name, shipped once and ranked in the browser on every keystroke. Same visibility as
 * quickSearch (scope-sql.ts); every query goes out in one D1 wave.
 *
 * Rows are positional arrays, not objects, so the JSON carries no repeated keys and
 * gzips well. Fields that change on every view (view counts) stay out, so the ETag only
 * moves when something searchable does.
 */

export const SEARCH_INDEX_VERSION = 1;
/** Most-recent artifacts kept; older ones are still reachable through deep search. */
export const INDEX_MAX_ARTIFACTS = 3000;
export const INDEX_DESC_CHARS = 80;
const MAX_FOLDERS = 500;
const MAX_PEOPLE = 500;
const RECENT_OPENED = 8;

/** [id, slug, name, type ('' = html), folderId, tags (\n-joined), updatedSec, desc, flags, ownerIdx (-1 none), wsIdx (-1 none)] */
export type IndexArtifact = [string, string, string, string, string, string, number, string, number, number, number];
/** [id, name, parentId ('' = top level), pageCount] */
export type IndexFolder = [string, string, string, number];
/** [userId, name, email, picture, role] */
export type IndexPerson = [string, string, string, string, string];

export const FLAG_PRIVATE = 1;
export const FLAG_THUMB = 2;

export interface SearchIndex {
  v: number;
  /** Artifacts were cut at INDEX_MAX_ARTIFACTS. */
  truncated: boolean;
  artifacts: IndexArtifact[];
  folders: IndexFolder[];
  people: IndexPerson[];
  /** [name, picture] — artifacts point here by index. */
  owners: [string, string][];
  /** [id, name] — set when searching across workspaces. */
  workspaces: [string, string][];
  /** Artifact ids the user opened last, most recent first. */
  recent: string[];
}

interface ArtRow {
  id: string; slug: string; name: string; artifact_type: string | null; folder_id: string | null;
  workspace_id: string | null; visibility: string | null; owner_id: string | null;
  owner_name: string | null; owner_picture: string | null; description: string | null;
  updated_at: string | null; thumbnail_ext: string | null; tags: string | null;
}

const secs = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
};
const clip = (s: string | null, n: number) => {
  const flat = (s || '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1).trimEnd() + '…' : flat;
};

export async function buildSearchIndex(env: Env, userId: string, sel: WorkspaceSelection | undefined): Promise<SearchIndex> {
  const wsId = concreteWorkspace(sel);
  const personal = sel === TELEGRAM_PERSONAL_WORKSPACE;
  const scope = artifactScopeSql(userId, sel);

  const artsP = env.DB.prepare(`
    SELECT a.id, COALESCE(d.slug, a.slug) AS slug, a.name, a.artifact_type, a.folder_id, a.workspace_id,
      a.visibility, a.owner_id, u.name AS owner_name, u.picture AS owner_picture,
      substr(a.description, 1, ${INDEX_DESC_CHARS + 40}) AS description,
      COALESCE(d.updated_at, a.created_at) AS updated_at, pres.thumbnail_ext,
      (SELECT GROUP_CONCAT(t.label, char(10)) FROM artifact_tags t WHERE t.artifact_id = a.id) AS tags
    FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    LEFT JOIN artifact_presentation pres ON pres.artifact_id = a.id
    LEFT JOIN users u ON u.id = a.owner_id
    WHERE a.deleted_at IS NULL AND a.id NOT IN (SELECT artifact_id FROM asset_buckets) AND (${scope.sql})
    ORDER BY COALESCE(d.updated_at, a.created_at) DESC
    LIMIT ?`).bind(...scope.binds, INDEX_MAX_ARTIFACTS + 1).all<ArtRow>();

  // Workspace-wide lists need membership; personal folders are the user's own.
  const member = wsId ? isMemberSql(userId, wsId) : null;
  const owners = linkedIds(userId);
  const foldersP = member
    ? env.DB.prepare(`
        SELECT f.id, f.name, f.parent_id, (SELECT COUNT(*) FROM artifacts a WHERE a.folder_id = f.id AND a.deleted_at IS NULL) AS n
        FROM folders f WHERE f.workspace_id = ? AND ${member.sql} ORDER BY f.name LIMIT ${MAX_FOLDERS}`)
        .bind(wsId, ...member.binds).all<{ id: string; name: string; parent_id: string | null; n: number }>()
    : env.DB.prepare(`
        SELECT f.id, f.name, f.parent_id, (SELECT COUNT(*) FROM artifacts a WHERE a.folder_id = f.id AND a.deleted_at IS NULL) AS n
        FROM folders f WHERE f.workspace_id IS NULL AND f.owner_id IN ${owners.sql} ORDER BY f.name LIMIT ${MAX_FOLDERS}`)
        .bind(...owners.binds).all<{ id: string; name: string; parent_id: string | null; n: number }>();
  const peopleP = member
    ? env.DB.prepare(`
        SELECT m.user_id, m.role, u.name, u.email, u.picture FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ? AND ${member.sql} LIMIT ${MAX_PEOPLE}`)
        .bind(wsId, ...member.binds).all<{ user_id: string; role: string; name: string | null; email: string | null; picture: string | null }>()
    : Promise.resolve({ results: [] });
  const wsNamesP = !wsId && !personal
    ? (() => {
        const ws = memberWorkspacesSql(userId);
        return env.DB.prepare(`SELECT id, name FROM workspaces WHERE id IN ${ws.sql}`).bind(...ws.binds).all<{ id: string; name: string }>();
      })()
    : Promise.resolve({ results: [] as { id: string; name: string }[] });
  const recentP = env.DB.prepare(
    `SELECT artifact_id FROM user_recent_views WHERE user_id = ? ORDER BY viewed_at DESC LIMIT ${RECENT_OPENED * 4}`,
  ).bind(userId).all<{ artifact_id: string }>();

  const [arts, folders, people, wsNames, recent] = await Promise.all([artsP, foldersP, peopleP, wsNamesP, recentP]);

  const rows = arts.results || [];
  const truncated = rows.length > INDEX_MAX_ARTIFACTS;
  const ownerIdx = new Map<string, number>();
  const ownerList: [string, string][] = [];
  const wsList: [string, string][] = (wsNames.results || []).map((w) => [w.id, w.name]);
  const wsIdx = new Map(wsList.map(([id], i) => [id, i]));
  const artifacts: IndexArtifact[] = rows.slice(0, INDEX_MAX_ARTIFACTS).map((r) => {
    let o = -1;
    if (r.owner_id && r.owner_name) {
      o = ownerIdx.get(r.owner_id) ?? -1;
      if (o < 0) { o = ownerList.push([r.owner_name, r.owner_picture || '']) - 1; ownerIdx.set(r.owner_id, o); }
    }
    const flags = (r.visibility === 'private' ? FLAG_PRIVATE : 0) | (r.thumbnail_ext ? FLAG_THUMB : 0);
    const type = r.artifact_type && r.artifact_type !== 'html' ? r.artifact_type : '';
    return [
      r.id, r.slug, r.name, type, r.folder_id || '', r.tags || '', secs(r.updated_at),
      clip(r.description, INDEX_DESC_CHARS), flags, o, r.workspace_id ? wsIdx.get(r.workspace_id) ?? -1 : -1,
    ];
  });
  const visible = new Set(artifacts.map((a) => a[0]));
  const recentIds = [...new Set((recent.results || []).map((r) => r.artifact_id))].filter((id) => visible.has(id)).slice(0, RECENT_OPENED);

  return {
    v: SEARCH_INDEX_VERSION,
    truncated,
    artifacts,
    folders: (folders.results || []).map((f) => [f.id, f.name, f.parent_id || '', f.n || 0]),
    people: (people.results || []).map((p) => [p.user_id, p.name || '', p.email || '', p.picture || '', p.role || 'member']),
    owners: ownerList,
    workspaces: wsList,
    recent: recentIds,
  };
}

/** Weak ETag over the body plus who asked for it, so two users never share one. */
export async function searchIndexEtag(userId: string, sel: WorkspaceSelection | undefined, body: string): Promise<string> {
  const data = new TextEncoder().encode(`${SEARCH_INDEX_VERSION}\u0000${userId}\u0000${sel ?? ''}\u0000${body}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `W/"si${[...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
}

/** True when an If-None-Match header names this ETag (weak comparison, lists, or *). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => t.trim() === '*' || bare(t) === bare(etag));
}
