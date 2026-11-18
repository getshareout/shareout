// The knowledge graph inside a workspace's KnowledgeStore: entities, typed relations
// and facts, each backed by `mentions` (source + chunk + quote). Every write is scoped
// to one source, so re-learning a source replaces exactly its own evidence. The names an
// entity goes by are kept per source too (`entity_names`), so a reader is only ever shown —
// or matched against — names that appear in a source they may open. What the team confirmed
// (status 'confirmed', curation.ts) has no source of its own: it survives every re-learn and
// is shown to every member.
import { normalizeName, type Extraction } from './extract';
import type { SourceKind } from './client';
import { CONFIRMED, guard, ignoredTypes } from './curation';

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
  // A name (canonical or alias) one source uses for an entity, kept only when it appears in
  // the passage that source's mention quotes. `entities.name` / `.aliases` stay as the
  // store-wide merge keys; readers get names from here.
  `CREATE TABLE IF NOT EXISTS entity_names (
    entity_id TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    name TEXT NOT NULL,
    norm TEXT NOT NULL,
    UNIQUE(entity_id, ref_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entity_names_ref ON entity_names(ref_id)`,
];

export interface Ref { refId: string; kind: SourceKind }
/** A name an entity goes by, and the source it appears in. */
export interface EntityName { name: string; ref: Ref }
export interface EntityRow {
  id: string; type: string; name: string; names: EntityName[]; status: string; mentions: number; refs: Ref[];
  /** Team-written: what it is, and the extra names the team gave it. */
  description: string; teamAliases: string[]; confirmedAt: string | null;
}
export interface RelationRow { id: string; from: string; type: string; to: string; mentions: number; refs: Ref[]; status: string }
/** `ref` is null for a fact the team added (it has no source). */
export interface FactRow { id: string; predicate: string; value: string; unit: string | null; validFrom: string | null; ref: Ref | null; ord: number; quote: string; status: string }
export interface MentionRow { ref: Ref; ord: number; locator: string; quote: string }

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const MAX_REFS = 20;
const NAME_REFS = 3; // sources returned per distinct name
const MAX_NAMES = 40; // (name, source) pairs returned per entity

/** Distinct sources behind a target, most recent first. */
function refsOf(q: Q, targetId: string): Ref[] {
  return q(
    `SELECT DISTINCT m.ref_id, s.kind FROM mentions m JOIN sources s ON s.ref_id = m.ref_id WHERE m.target_id = ? LIMIT ?`,
    targetId, MAX_REFS,
  ).toArray().map((r) => ({ refId: r.ref_id as string, kind: r.kind as SourceKind }));
}

/** The names an entity goes by, each with a source it appears in (a few sources per name). */
function namesOf(q: Q, entityId: string): EntityName[] {
  return q(
    `SELECT name, ref_id, kind FROM (
       SELECT n.name, n.ref_id, s.kind, n.rowid AS rid, ROW_NUMBER() OVER (PARTITION BY n.name ORDER BY n.rowid) AS rn
         FROM entity_names n JOIN sources s ON s.ref_id = n.ref_id WHERE n.entity_id = ?)
      WHERE rn <= ? ORDER BY rid LIMIT ?`,
    entityId, NAME_REFS, MAX_NAMES,
  ).toArray().map((r) => ({ name: r.name as string, ref: { refId: r.ref_id as string, kind: r.kind as SourceKind } }));
}

function toEntity(q: Q, r: Record<string, SqlStorageValue>): EntityRow {
  return {
    id: r.id as string,
    type: r.type as string,
    name: r.name as string,
    names: namesOf(q, r.id as string),
    status: r.status as string,
    mentions: r.mention_count as number,
    refs: refsOf(q, r.id as string),
    description: (r.description as string | null) ?? '',
    teamAliases: parseList(r.team_aliases),
    confirmedAt: (r.confirmed_at as string | null) ?? null,
  };
}

function parseList(v: unknown): string[] {
  try { const a = JSON.parse(String(v ?? '[]')); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

/** SQL filter keeping the team's ignored types out of what readers see. */
function notIgnored(q: Q): { sql: string; binds: string[] } {
  const ig = ignoredTypes(q);
  return ig.length ? { sql: ` AND type NOT IN (SELECT value FROM json_each(?))`, binds: [JSON.stringify(ig)] } : { sql: '', binds: [] };
}

// Compared after `normalizeName` on both sides, so "ACME Inc." is in "… Acme reported …".
function appearsIn(name: string, normText: string): boolean {
  const n = normalizeName(name);
  return !!n && normText.includes(n);
}

/** The passage a mention quotes, as the extractor saw it, normalized for appearsIn. */
function passage(q: Q, refId: string, ord: number, fallback: string): string {
  const c = q('SELECT title, locator, text FROM chunks WHERE ref_id = ? AND ord = ?', refId, ord).toArray()[0];
  return normalizeName(c ? `${c.title}\n${c.locator}\n${c.text}` : fallback);
}

const NAMES_BACKFILLED = 'entity_names_v1';

/**
 * Stores that learned entities before names were kept per source: credit each source with the
 * entity's names (canonical or alias) that appear in the passage its mention quotes. Once.
 */
export function ensureEntityNames(q: Q): void {
  if (q('SELECT 1 AS x FROM meta WHERE key = ?', NAMES_BACKFILLED).toArray().length) return;
  let key = '';
  let text = '';
  for (const m of q(
    `SELECT m.target_id, m.ref_id, m.ord, m.quote, e.name, e.aliases FROM mentions m JOIN entities e ON e.id = m.target_id
      ORDER BY m.ref_id, m.ord`,
  ).toArray()) {
    if (key !== `${m.ref_id}:${m.ord}`) {
      key = `${m.ref_id}:${m.ord}`;
      text = passage(q, m.ref_id as string, m.ord as number, m.quote as string);
    }
    for (const name of [m.name as string, ...(JSON.parse((m.aliases as string) || '[]') as string[])]) {
      if (appearsIn(name, text)) {
        q('INSERT OR IGNORE INTO entity_names (entity_id, ref_id, name, norm) VALUES (?, ?, ?, ?)', m.target_id, m.ref_id, name, normalizeName(name));
      }
    }
  }
  q("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')", NAMES_BACKFILLED);
}

/** The most-mentioned entities, so the extractor reuses their canonical names. */
export function knownEntities(q: Q, limit: number): { name: string; type: string }[] {
  return q(`SELECT name, type FROM entities ORDER BY (status = '${CONFIRMED}') DESC, mention_count DESC LIMIT ?`, limit)
    .toArray().map((r) => ({ name: r.name as string, type: r.type as string }));
}

/** Remove one source's evidence; drop draft entities/relations nothing supports anymore.
 *  What the team confirmed stays, with or without evidence. */
export function clearSourceGraph(q: Q, refId: string): void {
  q(`UPDATE entities SET mention_count = mention_count - (SELECT COUNT(*) FROM mentions m WHERE m.target_id = entities.id AND m.ref_id = ?)
      WHERE id IN (SELECT target_id FROM mentions WHERE ref_id = ?)`, refId, refId);
  q(`UPDATE relations SET mention_count = mention_count - (SELECT COUNT(*) FROM mentions m WHERE m.target_id = relations.id AND m.ref_id = ?)
      WHERE id IN (SELECT target_id FROM mentions WHERE ref_id = ?)`, refId, refId);
  q('DELETE FROM mentions WHERE ref_id = ?', refId);
  q('DELETE FROM entity_names WHERE ref_id = ?', refId);
  q('DELETE FROM facts WHERE ref_id = ?', refId);
  q(`DELETE FROM entities WHERE status = 'draft' AND mention_count <= 0
       AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.entity_id = entities.id)`);
  q(`DELETE FROM relations WHERE (mention_count <= 0 AND status != '${CONFIRMED}')
       OR from_id NOT IN (SELECT id FROM entities) OR to_id NOT IN (SELECT id FROM entities)`);
}

/** Merge one batch's extraction into the graph. Entities match on (type, normalized
 *  name); relation/fact endpoints match a batch entity first, then any type. The team's
 *  decisions come first: a name the team merged or renamed lands on the entity it kept, a
 *  confirmed entity keeps its name and type, and anything the team discarded or whose type
 *  it ignores is dropped. */
export function applyExtraction(q: Q, refId: string, x: Extraction): { entities: number; relations: number; facts: number } {
  ensureEntityNames(q); // before any new names, so the backfill only ever sees older mentions
  const team = guard(q);
  const byNorm = new Map<string, string | null>(); // null = dropped by the team in this batch
  const passages = new Map<number, string>();

  // The team's entity for a name: a redirect (merged/renamed/aliased), else a confirmed entity.
  const teamEntity = (norm: string): string | null => {
    const r = team.redirect(norm);
    if (r && q('SELECT 1 AS x FROM entities WHERE id = ?', r).toArray().length) return r;
    const hit = q(`SELECT id FROM entities WHERE norm = ? AND status = '${CONFIRMED}' LIMIT 1`, norm).toArray()[0];
    return hit ? (hit.id as string) : null;
  };

  const resolve = (name: string): string | null => {
    const norm = normalizeName(name);
    if (byNorm.has(norm)) return byNorm.get(norm)!;
    const t = teamEntity(norm);
    if (t) return t;
    if (team.entityDiscarded(norm)) return null;
    const hit = q('SELECT id, type FROM entities WHERE norm = ? ORDER BY mention_count DESC LIMIT 1', norm).toArray()[0];
    return hit && team.typeAllowed(hit.type as string) ? (hit.id as string) : null;
  };

  let entities = 0;
  for (const e of x.entities) {
    const norm = normalizeName(e.name);
    const names = [e.name, ...e.aliases];
    let id = names.map((n) => teamEntity(normalizeName(n))).find((v): v is string => !!v) ?? null;
    if (!id) {
      if (team.entityDiscarded(norm) || !team.typeAllowed(e.type)) {
        for (const n of names) if (normalizeName(n) && !byNorm.has(normalizeName(n))) byNorm.set(normalizeName(n), null);
        continue;
      }
      const existing = q('SELECT id FROM entities WHERE type = ? AND norm = ?', e.type, norm).toArray()[0];
      if (existing) id = existing.id as string;
    }
    if (id) {
      const row = q('SELECT aliases FROM entities WHERE id = ?', id).one();
      const aliases = new Set(JSON.parse(row.aliases as string) as string[]);
      for (const a of names) aliases.add(a);
      q('UPDATE entities SET aliases = ?, mention_count = mention_count + 1 WHERE id = ?', JSON.stringify([...aliases].slice(0, 20)), id);
    } else {
      id = newId('ent');
      q('INSERT INTO entities (id, type, name, norm, aliases, mention_count) VALUES (?, ?, ?, ?, ?, 1)',
        id, e.type, e.name, norm, JSON.stringify(e.aliases));
    }
    entities++;
    byNorm.set(norm, id);
    for (const a of e.aliases) if (normalizeName(a)) byNorm.set(normalizeName(a), id);
    q('INSERT INTO mentions (target_id, ref_id, ord, quote) VALUES (?, ?, ?, ?)', id, refId, e.ord, e.quote);
    // A name counts for this source only if its text has it: the extractor is shown names from
    // the whole workspace, and may echo one that this source never says.
    const text = passages.get(e.ord) ?? passage(q, refId, e.ord, e.quote);
    passages.set(e.ord, text);
    for (const name of names) {
      if (appearsIn(name, text)) {
        q('INSERT OR IGNORE INTO entity_names (entity_id, ref_id, name, norm) VALUES (?, ?, ?, ?)', id, refId, name, normalizeName(name));
      }
    }
  }

  let relations = 0;
  for (const r of x.relations) {
    const from = resolve(r.from), to = resolve(r.to);
    if (!from || !to || from === to || team.relationDiscarded(from, r.type, to)) continue;
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
    if (!entity || team.factDiscarded(entity, f.predicate, f.value)) continue;
    q('INSERT INTO facts (id, entity_id, predicate, value, unit, valid_from, ref_id, ord, quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('fct'), entity, f.predicate, f.value, f.unit, f.validFrom, refId, f.ord, f.quote);
    facts++;
  }
  return { entities, relations, facts };
}

/** Candidates only: the caller keeps those whose matching name appears in a source the reader may open. */
export function listEntities(q: Q, opts: { type?: string; q?: string; status?: 'confirmed' | 'draft'; limit: number }): EntityRow[] {
  ensureEntityNames(q);
  const ig = notIgnored(q);
  const where: string[] = [`(mention_count > 0 OR status = '${CONFIRMED}')${ig.sql}`];
  const binds: unknown[] = [...ig.binds];
  if (opts.type) { where.push('type = ?'); binds.push(opts.type); }
  if (opts.status) { where.push(opts.status === 'confirmed' ? `status = '${CONFIRMED}'` : `status != '${CONFIRMED}'`); }
  if (opts.q) {
    // Team entities also match on their own name and the aliases the team gave them.
    where.push(`(id IN (SELECT entity_id FROM entity_names WHERE norm LIKE ? OR name LIKE ?)
      OR (status = '${CONFIRMED}' AND (norm LIKE ? OR name LIKE ? OR team_aliases LIKE ?)))`);
    const nq = `%${normalizeName(opts.q)}%`, lq = `%${opts.q}%`;
    binds.push(nq, lq, nq, lq, lq);
  }
  return q(`SELECT * FROM entities WHERE ${where.join(' AND ')} ORDER BY (status = '${CONFIRMED}') DESC, mention_count DESC LIMIT ?`, ...binds, opts.limit)
    .toArray().map((r) => toEntity(q, r));
}

export function entityTypes(q: Q): { type: string; count: number }[] {
  const ig = notIgnored(q);
  return q(`SELECT type, COUNT(*) AS n FROM entities WHERE (mention_count > 0 OR status = '${CONFIRMED}')${ig.sql} GROUP BY type ORDER BY n DESC`, ...ig.binds)
    .toArray().map((r) => ({ type: r.type as string, count: r.n as number }));
}

export interface OtherEnd { id: string; type: string; name: string; names: EntityName[]; status: string; teamAliases: string[] }

export function getEntity(q: Q, id: string): {
  entity: EntityRow; facts: FactRow[]; relations: (RelationRow & { other: OtherEnd; direction: 'out' | 'in' })[]; mentions: MentionRow[];
} | null {
  ensureEntityNames(q);
  const row = q('SELECT * FROM entities WHERE id = ?', id).toArray()[0];
  if (!row) return null;
  const facts = q(
    `SELECT f.*, s.kind FROM facts f LEFT JOIN sources s ON s.ref_id = f.ref_id
      WHERE f.entity_id = ? AND (s.ref_id IS NOT NULL OR f.status = '${CONFIRMED}')
      ORDER BY (f.status = '${CONFIRMED}') DESC, f.valid_from DESC, f.predicate LIMIT 100`, id,
  ).toArray().map((r) => ({
    id: r.id as string, predicate: r.predicate as string, value: r.value as string, unit: (r.unit as string | null) ?? null,
    validFrom: (r.valid_from as string | null) ?? null, ref: r.kind ? { refId: r.ref_id as string, kind: r.kind as SourceKind } : null,
    ord: r.ord as number, quote: r.quote as string, status: r.status as string,
  }));
  const relations = q(
    `SELECT r.*, CASE WHEN r.from_id = ? THEN 'out' ELSE 'in' END AS direction, o.id AS other_id, o.name AS other_name, o.type AS other_type,
            o.status AS other_status, o.team_aliases AS other_team_aliases
       FROM relations r JOIN entities o ON o.id = CASE WHEN r.from_id = ? THEN r.to_id ELSE r.from_id END
      WHERE (r.from_id = ? OR r.to_id = ?) AND (r.mention_count > 0 OR r.status = '${CONFIRMED}')${notIgnored(q).sql.replace('type', 'o.type')}
      ORDER BY (r.status = '${CONFIRMED}') DESC, r.mention_count DESC LIMIT 100`,
    id, id, id, id, ...notIgnored(q).binds,
  ).toArray().map((r) => ({
    id: r.id as string, from: r.from_id as string, type: r.type as string, to: r.to_id as string,
    mentions: r.mention_count as number, refs: refsOf(q, r.id as string), direction: r.direction as 'out' | 'in', status: r.status as string,
    other: {
      id: r.other_id as string, type: r.other_type as string, name: r.other_name as string, names: namesOf(q, r.other_id as string),
      status: r.other_status as string, teamAliases: parseList(r.other_team_aliases),
    },
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
  ensureEntityNames(q);
  const ids = new Set<string>();
  if (opts.focus) {
    let frontier = [opts.focus];
    ids.add(opts.focus);
    for (let d = 0; d < opts.depth && frontier.length && ids.size < opts.limit; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const r of q(`SELECT from_id, to_id FROM relations WHERE (from_id = ? OR to_id = ?) AND (mention_count > 0 OR status = '${CONFIRMED}')
                              ORDER BY (status = '${CONFIRMED}') DESC, mention_count DESC LIMIT 50`, id, id).toArray()) {
          for (const n of [r.from_id as string, r.to_id as string]) {
            if (!ids.has(n) && ids.size < opts.limit) { ids.add(n); next.push(n); }
          }
        }
      }
      frontier = next;
    }
  } else {
    for (const r of q(`SELECT id FROM entities WHERE mention_count > 0 OR status = '${CONFIRMED}' ORDER BY mention_count DESC LIMIT ?`, opts.limit).toArray()) ids.add(r.id as string);
  }
  if (!ids.size) return { nodes: [], edges: [] };
  // One JSON parameter instead of one per id — SQLite caps bound parameters.
  const list = JSON.stringify([...ids]);
  const inList = '(SELECT value FROM json_each(?))';
  const ig = notIgnored(q);
  // The focus stays even when its type is ignored: someone opened it on purpose.
  const nodes = q(`SELECT * FROM entities WHERE id IN ${inList} AND (id = ?${ig.sql ? ` OR (1${ig.sql})` : ' OR 1'})`, list, opts.focus ?? '', ...ig.binds).toArray().map((r) => toEntity(q, r));
  const kept = JSON.stringify(nodes.map((n) => n.id));
  const edges = q(`SELECT * FROM relations WHERE (mention_count > 0 OR status = '${CONFIRMED}') AND from_id IN ${inList} AND to_id IN ${inList}`, kept, kept)
    .toArray().map((r) => ({
      id: r.id as string, from: r.from_id as string, type: r.type as string, to: r.to_id as string,
      mentions: r.mention_count as number, refs: refsOf(q, r.id as string), status: r.status as string,
    }));
  return { nodes, edges };
}
