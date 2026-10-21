// Knowledge notes <-> the artifacts they were learned from, in both directions, with the
// corpus visibility rule (visibleSources): a member only sees artifacts they may open.
import type { Env } from '../types';
import { visibleSources } from './corpus/search';
import { JSON_IN, jsonList } from '../sql-in';
import { parseKnowledge } from './parse';
import type { KnowledgeNode } from './types';

export interface SourceArtifact { id: string; slug: string | null; title: string | null; url: string | null; available: boolean }

/** A node's sources[] (artifact ids), named and linked only when this member may open them. */
export async function sourceArtifacts(env: Env, workspaceId: string, userId: string, ids: string[]): Promise<SourceArtifact[]> {
  if (!ids.length) return [];
  const { visible } = await visibleSources(env, workspaceId, userId, ids.map((refId) => ({ refId, kind: 'page' as const })));
  return ids.map((id) => {
    const v = visible.get(id);
    return v ? { id, slug: v.slug ?? null, title: v.title, url: v.url, available: true } : { id, slug: null, title: null, url: null, available: false };
  });
}

const MAX_NOTES = 50;

/** Knowledge notes whose sources include this artifact, or [] when the member may not open it.
 *  Sources live only in each note's frontmatter, so this is one D1 scan of the workspace's
 *  knowledge rows (instr prefilter), then a parse to confirm the id is really in sources[]. */
export async function notesFromArtifact(env: Env, workspaceId: string, userId: string, artifactId: string): Promise<Pick<KnowledgeNode, 'path' | 'kind' | 'id' | 'title'>[]> {
  const { visible } = await visibleSources(env, workspaceId, userId, [{ refId: artifactId, kind: 'page' }]);
  if (!visible.has(artifactId)) return [];
  const rows = (await env.DB.prepare(
    "SELECT path, content FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge' AND instr(content, ?) > 0 ORDER BY path",
  ).bind(workspaceId, artifactId).all<{ path: string; content: string }>()).results || [];
  return parseKnowledge(rows).nodes
    .filter((n) => n.sources.includes(artifactId))
    .slice(0, MAX_NOTES)
    .map((n) => ({ path: n.path, kind: n.kind, id: n.id, title: n.title }));
}

/** Drops notes learned from a page this member may not open (private, someone else's): a note's
 *  body carries its sources' content, so one such source hides the whole note from them. */
export async function readableNodes<T extends { sources: string[] }>(env: Env, workspaceId: string, userId: string, nodes: T[]): Promise<T[]> {
  const ids = [...new Set(nodes.flatMap((n) => n.sources))];
  if (!ids.length) return nodes;
  const rows = (await env.DB.prepare(
    `SELECT id FROM artifacts WHERE workspace_id = ? AND visibility = 'private' AND owner_id != ? AND id IN ${JSON_IN}`,
  ).bind(workspaceId, userId, jsonList(ids)).all<{ id: string }>()).results || [];
  if (!rows.length) return nodes;
  const blocked = new Set(rows.map((r) => r.id));
  return nodes.filter((n) => !n.sources.some((id) => blocked.has(id)));
}
