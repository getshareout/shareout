// The knowledge graph inside a workspace's KnowledgeStore: entities, typed relations
// and facts, each backed by `mentions` (source + chunk + quote). Every write is scoped
// to one source, so re-learning a source replaces exactly its own evidence.
import { normalizeName, type Extraction } from './extract';
import type { SourceKind } from './client';

type Q = (query: string, ...bindings: unknown[]) => SqlStorageCursor<Record<string, SqlStorageValue>>;

export const GRAPH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    norm TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    mention_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(type, norm)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entities_norm ON entities(norm)`,
  `CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    mention_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(from_id, type, to_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id)`,
  `CREATE TABLE IF NOT EXISTS facts (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    predicate TEXT NOT NULL,
    value TEXT NOT NULL,
    unit TEXT,
    valid_from TEXT,
    ref_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    quote TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_facts_ref ON facts(ref_id)`,
  `CREATE TABLE IF NOT EXISTS mentions (
    target_id TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    quote TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mentions_target ON mentions(target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mentions_ref ON mentions(ref_id)`,
];

export interface Ref { refId: string; kind: SourceKind }
export interface EntityRow { id: string; type: string; name: string; aliases: string[]; status: string; mentions: number; refs: Ref[] }
export interface RelationRow { id: string; from: string; type: string; to: string; mentions: number; refs: Ref[] }
export interface FactRow { id: string; predicate: string; value: string; unit: string | null; validFrom: string | null; ref: Ref; ord: number; quote: string }
export interface MentionRow { ref: Ref; ord: number; locator: string; quote: string }

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const MAX_REFS = 20;

/** Distinct sources behind a target, most recent first. */
function refsOf(q: Q, targetId: string): Ref[] {
  return q(
    `SELECT DISTINCT m.ref_id, s.kind FROM mentions m JOIN sources s ON s.ref_id = m.ref_id WHERE m.target_id = ? LIMIT ?`,
    targetId, MAX_REFS,
  ).toArray().map((r) => ({ refId: r.ref_id as string, kind: r.kind as SourceKind }));
}

function toEntity(q: Q, r: Record<string, SqlStorageValue>): EntityRow {
  return {
    id: r.id as string,
    type: r.type as string,
    name: r.name as string,
    aliases: JSON.parse((r.aliases as string) || '[]') as string[],
    status: r.status as string,
    mentions: r.mention_count as number,
    refs: refsOf(q, r.id as string),
  };
}

/** The most-mentioned entities, so the extractor reuses their canonical names. */
export function knownEntities(q: Q, limit: number): { name: string; type: string }[] {
  return q('SELECT name, type FROM entities ORDER BY mention_count DESC LIMIT ?', limit)
    .toArray().map((r) => ({ name: r.name as string, type: r.type as string }));
}

/** Remove one source's evidence; drop draft entities/relations nothing supports anymore. */
export function clearSourceGraph(q: Q, refId: string): void {
  q(`UPDATE entities SET mention_count = mention_count - (SELECT COUNT(*) FROM mentions m WHERE m.target_id = entities.id AND m.ref_id = ?)
      WHERE id IN (SELECT target_id FROM mentions WHERE ref_id = ?)`, refId, refId);
  q(`UPDATE relations SET mention_count = mention_count - (SELECT COUNT(*) FROM mentions m WHERE m.target_id = relations.id AND m.ref_id = ?)
      WHERE id IN (SELECT target_id FROM mentions WHERE ref_id = ?)`, refId, refId);
  q('DELETE FROM mentions WHERE ref_id = ?', refId);
  q('DELETE FROM facts WHERE ref_id = ?', refId);
  q(`DELETE FROM entities WHERE status = 'draft' AND mention_count <= 0
       AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.entity_id = entities.id)`);
  q(`DELETE FROM relations WHERE mention_count <= 0
       OR from_id NOT IN (SELECT id FROM entities) OR to_id NOT IN (SELECT id FROM entities)`);
}

/** Merge one batch's extraction into the graph. Entities match on (type, normalized
 *  name); relation/fact endpoints match a batch entity first, then any type. */
export function applyExtraction(q: Q, refId: string, x: Extraction): { entities: number; relations: number; facts: number } {
  const byNorm = new Map<string, string>();

  const resolve = (name: string): string | null => {
    const norm = normalizeName(name);
    if (byNorm.has(norm)) return byNorm.get(norm)!;
    const hit = q('SELECT id FROM entities WHERE norm = ? ORDER BY mention_count DESC LIMIT 1', norm).toArray()[0];
    return hit ? (hit.id as string) : null;
  };

  for (const e of x.entities) {
    const norm = normalizeName(e.name);
    const existing = q('SELECT id, aliases FROM entities WHERE type = ? AND norm = ?', e.type, norm).toArray()[0];
    let id: string;
    if (existing) {
      id = existing.id as string;
      const aliases = new Set(JSON.parse(existing.aliases as string) as string[]);
      for (const a of [e.name, ...e.aliases]) aliases.add(a);
      q('UPDATE entities SET aliases = ?, mention_count = mention_count + 1 WHERE id = ?', JSON.stringify([...aliases].slice(0, 20)), id);
    } else {
      id = newId('ent');
      q('INSERT INTO entities (id, type, name, norm, aliases, mention_count) VALUES (?, ?, ?, ?, ?, 1)',
        id, e.type, e.name, norm, JSON.stringify(e.aliases));
    }
    byNorm.set(norm, id);
    for (const a of e.aliases) if (normalizeName(a)) byNorm.set(normalizeName(a), id);
    q('INSERT INTO mentions (target_id, ref_id, ord, quote) VALUES (?, ?, ?, ?)', id, refId, e.ord, e.quote);
  }

  let relations = 0;
  for (const r of x.relations) {
    const from = resolve(r.from), to = resolve(r.to);
    if (!from || !to || from === to) continue;
    const existing = q('SELECT id FROM relations WHERE from_id = ? AND type = ? AND to_id = ?', from, r.type, to).toArray()[0];
    const id = existing ? (existing.id as string) : newId('rel');
    if (existing) q('UPDATE relations SET mention_count = mention_count + 1 WHERE id = ?', id);
    else q('INSERT INTO relations (id, from_id, type, to_id, mention_count) VALUES (?, ?, ?, ?, 1)', id, from, r.type, to);
    q('INSERT INTO mentions (target_id, ref_id, ord, quote) VALUES (?, ?, ?, ?)', id, refId, r.ord, r.quote);
    relations++;
  }

  let facts = 0;
  for (const f of x.facts) {
    const entity = resolve(f.entity);
    if (!entity) continue;
    q('INSERT INTO facts (id, entity_id, predicate, value, unit, valid_from, ref_id, ord, quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('fct'), entity, f.predicate, f.value, f.unit, f.validFrom, refId, f.ord, f.quote);
    facts++;
  }
  return { entities: x.entities.length, relations, facts };
}

export function listEntities(q: Q, opts: { type?: string; q?: string; limit: number }): EntityRow[] {
  const where: string[] = ['mention_count > 0'];
  const binds: unknown[] = [];
  if (opts.type) { where.push('type = ?'); binds.push(opts.type); }
  if (opts.q) { where.push("(norm LIKE ? OR aliases LIKE ?)"); binds.push(`%${normalizeName(opts.q)}%`, `%${opts.q}%`); }
  return q(`SELECT * FROM entities WHERE ${where.join(' AND ')} ORDER BY mention_count DESC LIMIT ?`, ...binds, opts.limit)
    .toArray().map((r) => toEntity(q, r));
}

export function entityTypes(q: Q): { type: string; count: number }[] {
  return q('SELECT type, COUNT(*) AS n FROM entities WHERE mention_count > 0 GROUP BY type ORDER BY n DESC')
    .toArray().map((r) => ({ type: r.type as string, count: r.n as number }));
}

export function getEntity(q: Q, id: string): {
  entity: EntityRow; facts: FactRow[]; relations: (RelationRow & { other: { id: string; name: string; type: string }; direction: 'out' | 'in' })[]; mentions: MentionRow[];
} | null {
  const row = q('SELECT * FROM entities WHERE id = ?', id).toArray()[0];
  if (!row) return null;
  const facts = q(
    `SELECT f.*, s.kind FROM facts f JOIN sources s ON s.ref_id = f.ref_id WHERE f.entity_id = ? ORDER BY f.valid_from DESC, f.predicate LIMIT 100`, id,
  ).toArray().map((r) => ({
    id: r.id as string, predicate: r.predicate as string, value: r.value as string, unit: (r.unit as string | null) ?? null,
    validFrom: (r.valid_from as string | null) ?? null, ref: { refId: r.ref_id as string, kind: r.kind as SourceKind },
    ord: r.ord as number, quote: r.quote as string,
  }));
  const relations = q(
    `SELECT r.*, CASE WHEN r.from_id = ? THEN 'out' ELSE 'in' END AS direction, o.id AS other_id, o.name AS other_name, o.type AS other_type
       FROM relations r JOIN entities o ON o.id = CASE WHEN r.from_id = ? THEN r.to_id ELSE r.from_id END
      WHERE (r.from_id = ? OR r.to_id = ?) AND r.mention_count > 0 ORDER BY r.mention_count DESC LIMIT 100`,
    id, id, id, id,
  ).toArray().map((r) => ({
    id: r.id as string, from: r.from_id as string, type: r.type as string, to: r.to_id as string,
    mentions: r.mention_count as number, refs: refsOf(q, r.id as string), direction: r.direction as 'out' | 'in',
    other: { id: r.other_id as string, name: r.other_name as string, type: r.other_type as string },
  }));
  const mentions = q(
    `SELECT m.ref_id, s.kind, m.ord, m.quote, COALESCE(c.locator, '') AS locator
       FROM mentions m JOIN sources s ON s.ref_id = m.ref_id
       LEFT JOIN chunks c ON c.ref_id = m.ref_id AND c.ord = m.ord
      WHERE m.target_id = ? LIMIT 50`, id,
  ).toArray().map((r) => ({
    ref: { refId: r.ref_id as string, kind: r.kind as SourceKind }, ord: r.ord as number, locator: r.locator as string, quote: r.quote as string,
  }));
  return { entity: toEntity(q, row), facts, relations, mentions };
}

/** A neighbourhood around `focus` (breadth-first up to `depth`), or the most-mentioned
 *  entities and the relations among them when there's no focus. */
export function graph(q: Q, opts: { focus?: string; depth: number; limit: number }): { nodes: EntityRow[]; edges: RelationRow[] } {
  const ids = new Set<string>();
  if (opts.focus) {
    let frontier = [opts.focus];
    ids.add(opts.focus);
    for (let d = 0; d < opts.depth && frontier.length && ids.size < opts.limit; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const r of q('SELECT from_id, to_id FROM relations WHERE (from_id = ? OR to_id = ?) AND mention_count > 0 ORDER BY mention_count DESC LIMIT 50', id, id).toArray()) {
          for (const n of [r.from_id as string, r.to_id as string]) {
            if (!ids.has(n) && ids.size < opts.limit) { ids.add(n); next.push(n); }
          }
        }
      }
      frontier = next;
    }
  } else {
    for (const r of q('SELECT id FROM entities WHERE mention_count > 0 ORDER BY mention_count DESC LIMIT ?', opts.limit).toArray()) ids.add(r.id as string);
  }
  if (!ids.size) return { nodes: [], edges: [] };
  // One JSON parameter instead of one per id — SQLite caps bound parameters.
  const list = JSON.stringify([...ids]);
  const inList = '(SELECT value FROM json_each(?))';
  const nodes = q(`SELECT * FROM entities WHERE id IN ${inList}`, list).toArray().map((r) => toEntity(q, r));
  const edges = q(`SELECT * FROM relations WHERE mention_count > 0 AND from_id IN ${inList} AND to_id IN ${inList}`, list, list)
    .toArray().map((r) => ({
      id: r.id as string, from: r.from_id as string, type: r.type as string, to: r.to_id as string,
      mentions: r.mention_count as number, refs: refsOf(q, r.id as string),
    }));
  return { nodes, edges };
}
