// The nightly consolidator's model-free steps: pruning digests of pages that are gone or
// private, re-queueing digests past their stale_after date, finding the learned notes that cite
// a page members can no longer all open (and the digests to rebuild them from), and keeping the
// timeline month files.
import type { Env } from '../types';
import { upsertLearnedFile, deleteKnowledgeFile, getKnowledgeFile } from './store';
import { deleteKnowledgeVector } from './distill';
import { enqueueIngest } from './ingest';
import { parseNode } from './parse';
import { withdrawnSources } from './source-links';
import { JSON_IN, jsonList } from '../sql-in';
import type { KnowledgeNode } from './types';
import {
  timelinePath,
  artifactDigestPath,
  artifactIdFromDigestPath,
  INDEX_PATH,
  PROVENANCE_LINE,
  provenanceIncomplete,
} from './types';

const REBUILD_MAX_DIGESTS = 30; // a page rebuilt from its sources: newest first
const MAX_TIMELINE_LINES = 200; // per month file

const yamlList = (items: string[]) => `[${items.map(s => JSON.stringify(s)).join(', ')}]`;

export function byLearnedDesc(a: KnowledgeNode, b: KnowledgeNode): number {
  return (b.learnedAt ?? '').localeCompare(a.learnedAt ?? '');
}

// ---------- prune (runs FIRST per workspace) ----------

export interface Removed {
  artifactId: string;
  title: string;
  topics: string[];
  entities: string[];
}

export async function pruneDeadDigests(env: Env, ws: string): Promise<Removed[]> {
  // artifactId from path 'artifacts/<id>.md': len('artifacts/')=10 → substr start 11;
  // trailing '.md' (3) added to the 10 → subtract 10+3=13 from the length.
  // A page made private loses its digest too (the PATCH route already drops it; this catches
  // every other way a page goes private).
  const rows = (
    await env.DB.prepare(
      `SELECT kf.path, kf.content, kf.source FROM workspace_files kf
       LEFT JOIN artifacts a ON a.id = substr(kf.path, 11, length(kf.path) - 13)
       WHERE kf.workspace_id = ? AND kf.namespace = 'knowledge' AND kf.path LIKE 'artifacts/%'
         AND (a.id IS NULL OR a.deleted_at IS NOT NULL OR a.visibility = 'private')
       LIMIT 200`
    )
      .bind(ws)
      .all<{ path: string; content: string; source: string }>()
  ).results;

  const removed: Removed[] = [];
  for (const row of rows) {
    const { node } = parseNode(row.path, row.content);
    // HARD RULE: pinned or manual digests are the human's — never pruned.
    // Parse failure (node undefined) → keep: corrupted frontmatter could be a pinned node.
    if (!node || row.source === 'manual' || node.pinned) continue;
    await deleteKnowledgeFile(env, ws, row.path); // plain delete, no tombstone — republish re-learns
    await deleteKnowledgeVector(env, ws, row.path);
    removed.push({
      artifactId: artifactIdFromDigestPath(row.path),
      title: node?.title ?? artifactIdFromDigestPath(row.path),
      topics: node?.topics ?? [],
      entities: node?.entities ?? [],
    });
  }
  return removed;
}

export async function reenqueueStaleDigests(env: Env, ws: string, today: string): Promise<void> {
  // Cheap prefilter ('stale_after' only appears in a digest that declares one) + LIMIT
  // keep this off a full-content scan of every digest every night (spec §2: targeted reads).
  const rows = (
    await env.DB.prepare(
      `SELECT path, content FROM workspace_files
       WHERE workspace_id = ? AND namespace = 'knowledge' AND path LIKE 'artifacts/%'
         AND content LIKE '%stale_after%'
       LIMIT 200`
    )
      .bind(ws)
      .all<{ path: string; content: string }>()
  ).results;
  for (const row of rows) {
    const { node } = parseNode(row.path, row.content);
    if (node?.staleAfter && node.staleAfter < today) {
      // null hash forces the distiller to reprocess fresh content this hour-cycle.
      await enqueueIngest(env, ws, artifactIdFromDigestPath(row.path), 'stale', null);
    }
  }
}

// ---------- stale notes (a source members can no longer all open) ----------

// A learned note is stale when it may hold content not every member can open: it cites a page
// that went private or into the trash, or it was written before source lists were complete
// (provenanceIncomplete). Readers already skip one citing a withdrawn page; this run rebuilds
// it without that page. Hand-written and pinned notes are the human's and are never rewritten.
export function isStale(n: KnowledgeNode, withdrawn: Set<string>): boolean {
  return n.sources.some(id => withdrawn.has(id)) || provenanceIncomplete(n);
}

export async function findStaleNotes(
  env: Env,
  ws: string,
  alsoCheck: string[] = []
): Promise<{ withdrawn: Set<string>; stale: Set<string> }> {
  const rows = (
    await env.DB.prepare(
      `SELECT path, content FROM workspace_files
       WHERE workspace_id = ? AND namespace = 'knowledge' AND source != 'manual'
         AND (path LIKE 'topics/%' OR path LIKE 'entities/%' OR path LIKE 'timeline/%' OR path = ?)`
    )
      .bind(ws, INDEX_PATH)
      .all<{ path: string; content: string }>()
  ).results;
  const notes = rows
    .map(r => parseNode(r.path, r.content).node)
    .filter((n): n is KnowledgeNode => !!n && !n.pinned);
  const withdrawn = await withdrawnSources(env, ws, [...notes.flatMap(n => n.sources), ...alsoCheck]);
  return { withdrawn, stale: new Set(notes.filter(n => isStale(n, withdrawn)).map(n => n.path)) };
}

async function loadDigests(env: Env, ws: string, artifactIds: string[]): Promise<KnowledgeNode[]> {
  if (!artifactIds.length) return [];
  const rows = (
    await env.DB.prepare(
      `SELECT path, content FROM workspace_files
       WHERE workspace_id = ? AND namespace = 'knowledge' AND path IN ${JSON_IN}`
    )
      .bind(ws, jsonList(artifactIds.map(artifactDigestPath)))
      .all<{ path: string; content: string }>()
  ).results;
  return rows.map(r => parseNode(r.path, r.content).node).filter((n): n is KnowledgeNode => !!n);
}

// What a stale page is rebuilt from: the digests of the sources it may keep, plus tonight's new
// ones for it, newest first. It starts over rather than merging into its current body, which
// could carry forward a fact only a withdrawn page held.
export async function rebuildFeed(
  env: Env,
  ws: string,
  oldSources: string[],
  fresh: KnowledgeNode[],
  withdrawn: Set<string>
): Promise<KnowledgeNode[]> {
  const byPath = new Map<string, KnowledgeNode>();
  const kept = await loadDigests(env, ws, oldSources.filter(id => !withdrawn.has(id)));
  for (const d of [...fresh, ...kept]) {
    if (!d.sources.some(id => withdrawn.has(id))) byPath.set(d.path, d);
  }
  return [...byPath.values()].sort(byLearnedDesc).slice(0, REBUILD_MAX_DIGESTS);
}

// Nothing members can all open is left behind this page: remove it. No tombstone — pages that
// cover the subject later learn it again.
export async function dropPage(env: Env, ws: string, path: string): Promise<boolean> {
  await deleteKnowledgeFile(env, ws, path);
  await deleteKnowledgeVector(env, ws, path);
  return true;
}

// ---------- timeline ----------

const timelineLineId = (line: string) => line.match(/\[([^\]]+)\]$/)?.[1] ?? '';

// `staleMonths` are month files that cite a withdrawn page (or predate complete sources):
// they are rewritten even with nothing new, dropping the lines that name a withdrawn page.
export async function appendTimeline(
  env: Env,
  nowIso: string,
  ws: string,
  digests: KnowledgeNode[],
  withdrawn: Set<string>,
  staleMonths: string[]
): Promise<void> {
  const byMonth = new Map<string, KnowledgeNode[]>(staleMonths.map(m => [m, []]));
  for (const d of digests) {
    const month = (d.learnedAt ?? nowIso).slice(0, 7);
    (byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(d);
  }
  for (const [month, list] of byMonth) {
    const path = timelinePath(month);
    const existing = await getKnowledgeFile(env, ws, path);
    if (existing?.source === 'manual') continue;
    const existingNode = existing ? parseNode(existing.path, existing.content).node : undefined;
    if (existingNode?.pinned) continue; // human-pinned month file — never rewritten
    const parsedBody = existingNode?.body ?? '';
    const lines = parsedBody
      .split('\n')
      .filter(l => l.startsWith('- ') && !l.startsWith('- …and') && !withdrawn.has(timelineLineId(l)));
    for (const d of list) {
      const id = d.sources[0] ?? artifactIdFromDigestPath(d.path);
      if (lines.some(l => l.includes(`[${id}]`))) continue; // dedupe by artifact id
      const when = (d.learnedAt ?? nowIso).slice(0, 10);
      const tags = d.topics.slice(0, 3).join(', ');
      lines.push(`- ${when}: learned ${JSON.stringify(d.title)}${tags ? ` (${tags})` : ''} [${id}]`);
    }
    if (!lines.length) {
      if (existing) await deleteKnowledgeFile(env, ws, path);
      continue;
    }
    lines.sort();
    let bodyLines = lines;
    if (lines.length > MAX_TIMELINE_LINES) {
      const overflow = lines.length - MAX_TIMELINE_LINES;
      bodyLines = [...lines.slice(0, MAX_TIMELINE_LINES), `- …and ${overflow} more`];
    }
    const ids = [...new Set(bodyLines.map(timelineLineId).filter(Boolean))];
    const title = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const fm = [
      '---',
      'kind: timeline',
      `id: timeline.${month}`,
      `title: ${JSON.stringify(title)}`,
      `sources: ${yamlList(ids)}`,
      PROVENANCE_LINE,
      'pinned: false',
      '---',
    ].join('\n');
    await upsertLearnedFile(env, ws, {
      path,
      content: `${fm}\n${bodyLines.join('\n')}\n`,
      source: 'consolidated',
    });
  }
}
