import type { Env } from '../types';
import type { WorkspaceSelection } from '../chat-platforms/types';
import { fromCorpus, type Passage } from '../chat-agent/tools/passages';
import { fuzzyScore, isWorkspaceMember, quickSearch, type SearchGroup, type SearchHit } from './quick-search';
import { artifactScopeSql, concreteWorkspace } from './scope-sql';

/**
 * The palette's second section: what the local index cannot answer. Names, tags,
 * folders and people are ranked in the browser (search-index.ts), so this skips them and
 * looks only at
 *  - artifact content: the full description, and with `older` the names of artifacts
 *    past the index cap;
 *  - Knowledge passages, when the workspace has Knowledge;
 *  - the groups the index does not carry (datasets, connectors, schedules, crew, alerts, skills).
 * D1 work goes out in one wave; the corpus waits only on the membership check.
 */

export const DEEP_GROUPS: SearchGroup[] = ['datasets', 'connectors', 'schedules', 'crew', 'alerts', 'skills'];
export const DEEP_MIN_QUERY = 2;
const CONTENT_LIMIT = 6;
const PASSAGE_MIN_QUERY = 3;

export interface DeepSearchResult {
  query: string;
  content: SearchHit[];
  passages: Passage[];
  datasets: SearchHit[];
  connectors: SearchHit[];
  schedules: SearchHit[];
  crew: SearchHit[];
  alerts: SearchHit[];
  skills: SearchHit[];
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

async function contentHits(env: Env, userId: string, sel: WorkspaceSelection | undefined, q: string, older: boolean): Promise<SearchHit[]> {
  const scope = artifactScopeSql(userId, sel);
  const like = `%${likeEscape(q)}%`;
  const nameClause = older ? ` OR a.name LIKE ? ESCAPE '\\'` : '';
  const rows = (await env.DB.prepare(`
    SELECT a.id, a.name, COALESCE(d.slug, a.slug) AS slug, a.artifact_type, a.description, a.visibility
    FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE a.deleted_at IS NULL AND a.id NOT IN (SELECT artifact_id FROM asset_buckets) AND (${scope.sql})
      AND (a.description LIKE ? ESCAPE '\\'${nameClause})
    ORDER BY COALESCE(d.updated_at, a.created_at) DESC
    LIMIT ?`).bind(...scope.binds, like, ...(older ? [like] : []), CONTENT_LIMIT * 3)
    .all<{ id: string; name: string; slug: string; artifact_type: string | null; description: string | null; visibility: string | null }>()).results || [];
  return rows
    .map((r) => ({
      kind: 'artifact' as const,
      id: r.id,
      title: r.name,
      slug: r.slug,
      artifactType: r.artifact_type || 'html',
      subtitle: excerpt(r.description || '', q),
      badge: r.visibility === 'private' ? 'Private' : undefined,
      score: Math.max(fuzzyScore(q, r.description || ''), fuzzyScore(q, r.name) * 0.9),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CONTENT_LIMIT);
}

/** A short window of `text` around the first match of `q` (case/accent-insensitive). */
function excerpt(text: string, q: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 120) return flat;
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const at = Math.max(0, fold(flat).indexOf(fold(q).trim()));
  const start = Math.max(0, at - 40);
  return `${start ? '…' : ''}${flat.slice(start, start + 120).trim()}…`;
}

export async function deepSearch(
  env: Env,
  userId: string,
  opts: { q: string; workspaceId?: WorkspaceSelection; older?: boolean; limit?: number },
): Promise<DeepSearchResult> {
  const q = (opts.q || '').trim().slice(0, 200);
  const empty: DeepSearchResult = { query: q, content: [], passages: [], datasets: [], connectors: [], schedules: [], crew: [], alerts: [], skills: [] };
  if (q.length < DEEP_MIN_QUERY) return empty;
  const wsId = concreteWorkspace(opts.workspaceId);
  const passagesP = wsId && q.length >= PASSAGE_MIN_QUERY
    ? isWorkspaceMember(env, userId, wsId).then((ok) => (ok ? fromCorpus(env, userId, [wsId], q) : [])).catch(() => [] as Passage[])
    : Promise.resolve([] as Passage[]);
  const [groups, content, passages] = await Promise.all([
    quickSearch(env, userId, { q, workspaceId: opts.workspaceId, groups: DEEP_GROUPS, limit: opts.limit ?? 5 }),
    contentHits(env, userId, opts.workspaceId, q, !!opts.older),
    passagesP,
  ]);
  return {
    query: q,
    content,
    passages,
    datasets: groups.datasets,
    connectors: groups.connectors,
    schedules: groups.schedules,
    crew: groups.crew,
    alerts: groups.alerts,
    skills: groups.skills,
  };
}
