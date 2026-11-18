// The team's hand on the knowledge graph. Owners and admins confirm, rename, retype, merge,
// connect and discard what the learner proposed, and write the types, glossary and rules it
// must follow. Every decision lives in the workspace's KnowledgeStore next to the learned
// graph, and the learner (graph-store.ts applyExtraction) reads it on every batch, so it
// outlives every re-learn of every source:
//   - confirmed entities, relations and facts are never renamed, retyped or dropped by it;
//   - a discarded name, relation or fact is never proposed again (graph_tombstones);
//   - a merged or renamed name lands on the entity the team kept (graph_redirects);
//   - ignored types are skipped, and with team_types_only nothing outside the team's types.
import { normalizeName, normalizeType, relationType } from './extract';

type Q = (query: string, ...bindings: unknown[]) => SqlStorageCursor<Record<string, SqlStorageValue>>;

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const CURATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS graph_tombstones (
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    reason TEXT,
    by_user TEXT,
    at TEXT NOT NULL DEFAULT (${NOW}),
    PRIMARY KEY (kind, key)
  )`,
  `CREATE TABLE IF NOT EXISTS graph_redirects (norm TEXT PRIMARY KEY, entity_id TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_graph_redirects_entity ON graph_redirects(entity_id)`,
  `CREATE TABLE IF NOT EXISTS graph_rules (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    term TEXT,
    text TEXT NOT NULL,
    by_user TEXT,
    at TEXT NOT NULL DEFAULT (${NOW})
  )`,
  `CREATE TABLE IF NOT EXISTS graph_types (
    type TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    ignored INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL DEFAULT (${NOW})
  )`,
  `CREATE TABLE IF NOT EXISTS graph_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (${NOW}),
    by_user TEXT,
    action TEXT NOT NULL,
    targets TEXT NOT NULL DEFAULT '[]',
    detail TEXT NOT NULL DEFAULT '{}'
  )`,
];

/** Columns the curation layer adds to graph tables that stores already have. */
export function migrateCuration(sql: SqlStorage): void {
  const cols = (t: string) => new Set(sql.exec(`PRAGMA table_info(${t})`).toArray().map((r) => r.name as string));
  const add = (t: string, have: Set<string>, col: string, ddl: string) => { if (!have.has(col)) sql.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${ddl}`); };
  const e = cols('entities');
  add('entities', e, 'description', `TEXT NOT NULL DEFAULT ''`);
  add('entities', e, 'team_aliases', `TEXT NOT NULL DEFAULT '[]'`);
  add('entities', e, 'confirmed_by', 'TEXT');
  add('entities', e, 'confirmed_at', 'TEXT');
  const r = cols('relations');
  add('relations', r, 'status', `TEXT NOT NULL DEFAULT 'draft'`);
  add('relations', r, 'confirmed_by', 'TEXT');
  const f = cols('facts');
  add('facts', f, 'status', `TEXT NOT NULL DEFAULT 'draft'`);
  add('facts', f, 'created_by', 'TEXT');
}

export const CONFIRMED = 'confirmed';
const TEAM_ONLY = 'team_types_only';
export const LIMITS = { name: 120, description: 2000, aliases: 20, alias: 120, predicate: 60, value: 200, unit: 20, term: 60, rule: 500, rules: 100, types: 40, typeDesc: 200, reason: 40 };

export type CurationOp =
  | { op: 'entity.create'; name: string; type: string; description?: string; aliases?: string[] }
  | { op: 'entity.update'; id: string; name?: string; type?: string; description?: string; aliases?: string[] }
  | { op: 'entity.confirm'; id: string }
  | { op: 'entity.discard'; id: string; reason?: string }
  | { op: 'entity.merge'; id: string; into: string }
  | { op: 'relation.create'; from: string; type: string; to: string }
  | { op: 'relation.confirm'; id: string }
  | { op: 'relation.discard'; id: string; reason?: string }
  | { op: 'fact.add'; entityId: string; predicate: string; value: string; unit?: string | null }
  | { op: 'fact.confirm'; id: string }
  | { op: 'fact.discard'; id: string }
  | { op: 'type.set'; type: string; description?: string; ignored?: boolean }
  | { op: 'type.remove'; type: string }
  | { op: 'schema.teamOnly'; on: boolean }
  | { op: 'rule.add'; kind: 'rule' | 'glossary'; term?: string; text: string }
  | { op: 'rule.remove'; id: string }
  | { op: 'discarded.restore'; kind: 'entity' | 'relation' | 'fact'; key: string };

export type CurationResult =
  | { ok: true; id?: string }
  | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID'; message: string; otherId?: string };

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const json = <T>(v: unknown, d: T): T => { try { return v ? (JSON.parse(String(v)) as T) : d; } catch { return d; } };
const fail = (code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID', message: string, otherId?: string): CurationResult => ({ ok: false, code, message, ...(otherId ? { otherId } : {}) });
// Discards are keyed by names, not ids: a learned entity gets a new id every time its source
// is re-learned, and the discard has to hold across that.
const relKey = (fromNorm: string, type: string, toNorm: string) => `${fromNorm}|${type}|${toNorm}`;
const factKey = (entityNorm: string, predicate: string, value: string) => `${entityNorm}|${predicate}|${normalizeName(value)}`;
const normOf = (q: Q, id: string) => (q('SELECT norm FROM entities WHERE id = ?', id).toArray()[0]?.norm as string | undefined) ?? '';

function cleanAliases(list: unknown, name: string): string[] {
  const out: string[] = [];
  for (const a of Array.isArray(list) ? list : []) {
    const v = clip(a, LIMITS.alias);
    if (v && v !== name && normalizeName(v) && !out.includes(v)) out.push(v);
  }
  return out.slice(0, LIMITS.aliases);
}

function log(q: Q, user: string, action: string, targets: string[], detail: Record<string, unknown>): void {
  q('INSERT INTO graph_log (by_user, action, targets, detail) VALUES (?, ?, ?, ?)', user, action, JSON.stringify(targets), JSON.stringify(detail));
}

function entityRow(q: Q, id: string) {
  return q('SELECT * FROM entities WHERE id = ?', id).toArray()[0];
}

/** Point these names at the entity, and lift any discard on them: the team wants them now. */
function claimNames(q: Q, id: string, names: string[]): void {
  for (const n of names) {
    const norm = normalizeName(n);
    if (!norm) continue;
    q('INSERT INTO graph_redirects (norm, entity_id) VALUES (?, ?) ON CONFLICT(norm) DO UPDATE SET entity_id = excluded.entity_id', norm, id);
    q("DELETE FROM graph_tombstones WHERE kind = 'entity' AND key = ?", norm);
  }
}

function confirmEntity(q: Q, id: string, user: string): void {
  q(`UPDATE entities SET status = ?, confirmed_by = COALESCE(confirmed_by, ?), confirmed_at = COALESCE(confirmed_at, ${NOW}) WHERE id = ?`, CONFIRMED, user, id);
}

/** Another entity already holds this (type, name). */
function clash(q: Q, id: string, type: string, norm: string): string | null {
  const hit = q('SELECT id FROM entities WHERE type = ? AND norm = ? AND id != ?', type, norm, id).toArray()[0];
  return hit ? (hit.id as string) : null;
}

export function curate(q: Q, user: string, op: CurationOp): CurationResult {
  switch (op.op) {
    case 'entity.create': {
      const name = clip(op.name, LIMITS.name);
      const norm = normalizeName(name);
      if (!norm) return fail('INVALID', 'name is required');
      const type = normalizeType(clip(op.type, 40));
      const aliases = cleanAliases(op.aliases, name);
      const existing = q('SELECT id FROM entities WHERE type = ? AND norm = ?', type, norm).toArray()[0];
      const id = existing ? (existing.id as string) : newId('ent');
      if (existing) {
        q('UPDATE entities SET name = ?, description = CASE WHEN ? != \'\' THEN ? ELSE description END WHERE id = ?', name, clip(op.description, LIMITS.description), clip(op.description, LIMITS.description), id);
      } else {
        q('INSERT INTO entities (id, type, name, norm, aliases, mention_count, description) VALUES (?, ?, ?, ?, ?, 0, ?)',
          id, type, name, norm, JSON.stringify(aliases), clip(op.description, LIMITS.description));
      }
      if (aliases.length) q('UPDATE entities SET team_aliases = ? WHERE id = ?', JSON.stringify(aliases), id);
      confirmEntity(q, id, user);
      claimNames(q, id, [name, ...aliases]);
      log(q, user, 'entity.create', [id], { name, type });
      return { ok: true, id };
    }
    case 'entity.update': {
      const row = entityRow(q, op.id);
      if (!row) return fail('NOT_FOUND', 'Entity not found');
      const before = { name: row.name as string, type: row.type as string };
      const name = op.name !== undefined ? clip(op.name, LIMITS.name) : before.name;
      const norm = normalizeName(name);
      if (!norm) return fail('INVALID', 'name is required');
      const type = op.type !== undefined ? normalizeType(clip(op.type, 40)) : before.type;
      const other = (name !== before.name || type !== before.type) ? clash(q, op.id, type, norm) : null;
      if (other) return fail('CONFLICT', `Another ${type} is already called “${name}” — merge them instead`, other);
      let team = json<string[]>(row.team_aliases, []);
      if (op.aliases !== undefined) team = cleanAliases(op.aliases, name);
      // The old name stays an alias, so documents that still use it land here.
      if (name !== before.name && !team.includes(before.name)) team = [before.name, ...team].slice(0, LIMITS.aliases);
      team = team.filter((a) => a !== name);
      const merge = new Set(json<string[]>(row.aliases, []));
      for (const a of team) merge.add(a);
      q('UPDATE entities SET name = ?, norm = ?, type = ?, team_aliases = ?, aliases = ?, description = ? WHERE id = ?',
        name, norm, type, JSON.stringify(team), JSON.stringify([...merge].slice(0, 30)),
        op.description !== undefined ? clip(op.description, LIMITS.description) : (row.description as string) ?? '', op.id);
      confirmEntity(q, op.id, user);
      claimNames(q, op.id, [name, ...team]);
      const changed: Record<string, unknown> = {};
      if (name !== before.name) changed.name = { from: before.name, to: name };
      if (type !== before.type) changed.type = { from: before.type, to: type };
      if (op.aliases !== undefined) changed.aliases = team;
      if (op.description !== undefined) changed.description = true;
      log(q, user, 'entity.update', [op.id], { name, ...changed });
      return { ok: true, id: op.id };
    }
    case 'entity.confirm': {
      const row = entityRow(q, op.id);
      if (!row) return fail('NOT_FOUND', 'Entity not found');
      confirmEntity(q, op.id, user);
      claimNames(q, op.id, [row.name as string]);
      log(q, user, 'entity.confirm', [op.id], { name: row.name });
      return { ok: true, id: op.id };
    }
    case 'entity.discard': {
      const row = entityRow(q, op.id);
      if (!row) return fail('NOT_FOUND', 'Entity not found');
      const names = [row.name as string, ...json<string[]>(row.team_aliases, [])];
      for (const n of names) {
        const norm = normalizeName(n);
        if (norm) q('INSERT OR REPLACE INTO graph_tombstones (kind, key, label, reason, by_user) VALUES (\'entity\', ?, ?, ?, ?)', norm, n, clip(op.reason, LIMITS.reason) || null, user);
      }
      const rels = q('SELECT id FROM relations WHERE from_id = ? OR to_id = ?', op.id, op.id).toArray().map((r) => r.id as string);
      for (const rid of rels) q('DELETE FROM mentions WHERE target_id = ?', rid);
      q('DELETE FROM relations WHERE from_id = ? OR to_id = ?', op.id, op.id);
      q('DELETE FROM mentions WHERE target_id = ?', op.id);
      q('DELETE FROM entity_names WHERE entity_id = ?', op.id);
      q('DELETE FROM facts WHERE entity_id = ?', op.id);
      q('DELETE FROM graph_redirects WHERE entity_id = ?', op.id);
      q('DELETE FROM entities WHERE id = ?', op.id);
      log(q, user, 'entity.discard', [op.id], { name: row.name, type: row.type, reason: clip(op.reason, LIMITS.reason) || null });
      return { ok: true, id: op.id };
    }
    case 'entity.merge': {
      if (op.id === op.into) return fail('INVALID', 'Pick another entity to merge into');
      const a = entityRow(q, op.id), b = entityRow(q, op.into);
      if (!a || !b) return fail('NOT_FOUND', 'Entity not found');
      const from = op.id, into = op.into;
      // Relations: re-point, folding duplicates into the one that already exists.
      for (const r of q('SELECT * FROM relations WHERE from_id = ? OR to_id = ?', from, from).toArray()) {
        const f = r.from_id === from ? into : (r.from_id as string);
        const t = r.to_id === from ? into : (r.to_id as string);
        if (f === t) { q('DELETE FROM mentions WHERE target_id = ?', r.id); q('DELETE FROM relations WHERE id = ?', r.id); continue; }
        const dup = q('SELECT id, status FROM relations WHERE from_id = ? AND type = ? AND to_id = ? AND id != ?', f, r.type, t, r.id).toArray()[0];
        if (dup) {
          q('UPDATE mentions SET target_id = ? WHERE target_id = ?', dup.id, r.id);
          q(`UPDATE relations SET mention_count = mention_count + ?, status = CASE WHEN ? = '${CONFIRMED}' THEN '${CONFIRMED}' ELSE status END WHERE id = ?`, r.mention_count, r.status, dup.id);
          q('DELETE FROM relations WHERE id = ?', r.id);
        } else {
          q('UPDATE relations SET from_id = ?, to_id = ? WHERE id = ?', f, t, r.id);
        }
      }
      q('UPDATE mentions SET target_id = ? WHERE target_id = ?', into, from);
      q('UPDATE OR IGNORE entity_names SET entity_id = ? WHERE entity_id = ?', into, from);
      q('DELETE FROM entity_names WHERE entity_id = ?', from);
      q('UPDATE facts SET entity_id = ? WHERE entity_id = ?', into, from);
      q('UPDATE graph_redirects SET entity_id = ? WHERE entity_id = ?', into, from);
      const team = new Set(json<string[]>(b.team_aliases, []));
      for (const n of [a.name as string, ...json<string[]>(a.team_aliases, [])]) if (n !== b.name) team.add(n);
      const merge = new Set([...json<string[]>(b.aliases, []), a.name as string, ...json<string[]>(a.aliases, [])]);
      q('UPDATE entities SET team_aliases = ?, aliases = ?, mention_count = mention_count + ?, description = CASE WHEN description = \'\' THEN ? ELSE description END WHERE id = ?',
        JSON.stringify([...team].slice(0, LIMITS.aliases + 10)), JSON.stringify([...merge].slice(0, 30)), a.mention_count, (a.description as string) ?? '', into);
      q('DELETE FROM entities WHERE id = ?', from);
      confirmEntity(q, into, user);
      claimNames(q, into, [a.name as string, ...json<string[]>(a.aliases, []), ...json<string[]>(a.team_aliases, []), b.name as string]);
      log(q, user, 'entity.merge', [into, from], { name: b.name, merged: a.name });
      return { ok: true, id: into };
    }
    case 'relation.create': {
      const type = relationType(clip(op.type, 40));
      if (!type) return fail('INVALID', 'type is required');
      if (op.from === op.to) return fail('INVALID', 'An entity cannot connect to itself');
      if (!entityRow(q, op.from) || !entityRow(q, op.to)) return fail('NOT_FOUND', 'Entity not found');
      const existing = q('SELECT id FROM relations WHERE from_id = ? AND type = ? AND to_id = ?', op.from, type, op.to).toArray()[0];
      const id = existing ? (existing.id as string) : newId('rel');
      if (existing) q('UPDATE relations SET status = ?, confirmed_by = COALESCE(confirmed_by, ?) WHERE id = ?', CONFIRMED, user, id);
      else q('INSERT INTO relations (id, from_id, type, to_id, mention_count, status, confirmed_by) VALUES (?, ?, ?, ?, 0, ?, ?)', id, op.from, type, op.to, CONFIRMED, user);
      q("DELETE FROM graph_tombstones WHERE kind = 'relation' AND key = ?", relKey(normOf(q, op.from), type, normOf(q, op.to)));
      // Connecting two things says both matter.
      confirmEntity(q, op.from, user); confirmEntity(q, op.to, user);
      log(q, user, 'relation.create', [op.from, op.to], { type });
      return { ok: true, id };
    }
    case 'relation.confirm': {
      const r = q('SELECT * FROM relations WHERE id = ?', op.id).toArray()[0];
      if (!r) return fail('NOT_FOUND', 'Connection not found');
      q('UPDATE relations SET status = ?, confirmed_by = COALESCE(confirmed_by, ?) WHERE id = ?', CONFIRMED, user, op.id);
      log(q, user, 'relation.confirm', [r.from_id as string, r.to_id as string], { type: r.type });
      return { ok: true, id: op.id };
    }
    case 'relation.discard': {
      const r = q('SELECT * FROM relations WHERE id = ?', op.id).toArray()[0];
      if (!r) return fail('NOT_FOUND', 'Connection not found');
      const label = `${(entityRow(q, r.from_id as string)?.name as string) ?? r.from_id} → ${r.type} → ${(entityRow(q, r.to_id as string)?.name as string) ?? r.to_id}`;
      q('INSERT OR REPLACE INTO graph_tombstones (kind, key, label, reason, by_user) VALUES (\'relation\', ?, ?, ?, ?)',
        relKey(normOf(q, r.from_id as string), r.type as string, normOf(q, r.to_id as string)), label, clip(op.reason, LIMITS.reason) || null, user);
      q('DELETE FROM mentions WHERE target_id = ?', op.id);
      q('DELETE FROM relations WHERE id = ?', op.id);
      log(q, user, 'relation.discard', [r.from_id as string, r.to_id as string], { type: r.type, reason: clip(op.reason, LIMITS.reason) || null });
      return { ok: true, id: op.id };
    }
    case 'fact.add': {
      if (!entityRow(q, op.entityId)) return fail('NOT_FOUND', 'Entity not found');
      const predicate = relationType(clip(op.predicate, LIMITS.predicate));
      const value = clip(op.value, LIMITS.value);
      if (!predicate || !value) return fail('INVALID', 'predicate and value are required');
      const id = newId('fct');
      q(`INSERT INTO facts (id, entity_id, predicate, value, unit, valid_from, ref_id, ord, quote, status, created_by) VALUES (?, ?, ?, ?, ?, NULL, '', 0, '', ?, ?)`,
        id, op.entityId, predicate, value, clip(op.unit, LIMITS.unit) || null, CONFIRMED, user);
      q("DELETE FROM graph_tombstones WHERE kind = 'fact' AND key = ?", factKey(normOf(q, op.entityId), predicate, value));
      confirmEntity(q, op.entityId, user);
      log(q, user, 'fact.add', [op.entityId], { predicate, value });
      return { ok: true, id };
    }
    case 'fact.confirm': {
      // A learned fact belongs to its source and goes when the source is re-learned: confirming
      // copies it into the team's own facts, replacing the team's value for that predicate.
      const f = q('SELECT * FROM facts WHERE id = ?', op.id).toArray()[0];
      if (!f) return fail('NOT_FOUND', 'Fact not found');
      if (f.status === CONFIRMED) return { ok: true, id: op.id };
      q('DELETE FROM facts WHERE entity_id = ? AND predicate = ? AND status = ?', f.entity_id, f.predicate, CONFIRMED);
      const id = newId('fct');
      q(`INSERT INTO facts (id, entity_id, predicate, value, unit, valid_from, ref_id, ord, quote, status, created_by) VALUES (?, ?, ?, ?, ?, ?, '', 0, '', ?, ?)`,
        id, f.entity_id, f.predicate, f.value, f.unit, f.valid_from, CONFIRMED, user);
      confirmEntity(q, f.entity_id as string, user);
      log(q, user, 'fact.confirm', [f.entity_id as string], { predicate: f.predicate, value: f.value });
      return { ok: true, id };
    }
    case 'fact.discard': {
      const f = q('SELECT * FROM facts WHERE id = ?', op.id).toArray()[0];
      if (!f) return fail('NOT_FOUND', 'Fact not found');
      if (f.status !== CONFIRMED) {
        q('INSERT OR REPLACE INTO graph_tombstones (kind, key, label, by_user) VALUES (\'fact\', ?, ?, ?)',
          factKey(normOf(q, f.entity_id as string), f.predicate as string, f.value as string), `${f.predicate}: ${f.value}`, user);
        // Every source that says it goes, not just this row.
        for (const o of q('SELECT id, value FROM facts WHERE entity_id = ? AND predicate = ? AND status != ?', f.entity_id, f.predicate, CONFIRMED).toArray()) {
          if (normalizeName(o.value as string) === normalizeName(f.value as string)) q('DELETE FROM facts WHERE id = ?', o.id);
        }
      } else {
        q('DELETE FROM facts WHERE id = ?', op.id);
      }
      log(q, user, 'fact.discard', [f.entity_id as string], { predicate: f.predicate, value: f.value });
      return { ok: true, id: op.id };
    }
    case 'type.set': {
      const type = normalizeType(clip(op.type, 40));
      const known = q('SELECT 1 AS x FROM graph_types WHERE type = ?', type).toArray().length;
      if (!known && (q('SELECT COUNT(*) AS n FROM graph_types').one().n as number) >= LIMITS.types) return fail('INVALID', `At most ${LIMITS.types} types`);
      q(`INSERT INTO graph_types (type, description, ignored) VALUES (?, ?, ?)
         ON CONFLICT(type) DO UPDATE SET description = CASE WHEN ? THEN excluded.description ELSE description END,
           ignored = CASE WHEN ? THEN excluded.ignored ELSE ignored END`,
        type, clip(op.description, LIMITS.typeDesc), op.ignored ? 1 : 0, op.description !== undefined ? 1 : 0, op.ignored !== undefined ? 1 : 0);
      log(q, user, 'type.set', [], { type, ...(op.ignored !== undefined ? { ignored: op.ignored } : {}), ...(op.description !== undefined ? { description: true } : {}) });
      return { ok: true, id: type };
    }
    case 'type.remove': {
      q('DELETE FROM graph_types WHERE type = ?', normalizeType(clip(op.type, 40)));
      log(q, user, 'type.remove', [], { type: op.type });
      return { ok: true };
    }
    case 'schema.teamOnly': {
      q("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", TEAM_ONLY, op.on ? '1' : '0');
      log(q, user, 'schema.teamOnly', [], { on: op.on });
      return { ok: true };
    }
    case 'rule.add': {
      const text = clip(op.text, LIMITS.rule);
      const kind = op.kind === 'glossary' ? 'glossary' : 'rule';
      const term = kind === 'glossary' ? clip(op.term, LIMITS.term) : '';
      if (!text || (kind === 'glossary' && !term)) return fail('INVALID', kind === 'glossary' ? 'term and meaning are required' : 'text is required');
      if ((q('SELECT COUNT(*) AS n FROM graph_rules').one().n as number) >= LIMITS.rules) return fail('INVALID', `At most ${LIMITS.rules} rules`);
      const id = newId('rul');
      q('INSERT INTO graph_rules (id, kind, term, text, by_user) VALUES (?, ?, ?, ?, ?)', id, kind, term || null, text, user);
      log(q, user, 'rule.add', [], { kind, term: term || null, text });
      return { ok: true, id };
    }
    case 'rule.remove': {
      const r = q('SELECT * FROM graph_rules WHERE id = ?', op.id).toArray()[0];
      if (!r) return fail('NOT_FOUND', 'Rule not found');
      q('DELETE FROM graph_rules WHERE id = ?', op.id);
      log(q, user, 'rule.remove', [], { kind: r.kind, term: r.term, text: r.text });
      return { ok: true };
    }
    case 'discarded.restore': {
      const t = q('SELECT * FROM graph_tombstones WHERE kind = ? AND key = ?', op.kind, op.key).toArray()[0];
      if (!t) return fail('NOT_FOUND', 'Nothing discarded under that key');
      q('DELETE FROM graph_tombstones WHERE kind = ? AND key = ?', op.kind, op.key);
      log(q, user, 'discarded.restore', [], { kind: op.kind, label: t.label });
      return { ok: true };
    }
  }
}

// ----- read side -----

export interface TeamType { type: string; description: string; ignored: boolean }

export function teamTypes(q: Q): TeamType[] {
  return q('SELECT type, description, ignored FROM graph_types ORDER BY at, type').toArray()
    .map((r) => ({ type: r.type as string, description: r.description as string, ignored: !!r.ignored }));
}

export function ignoredTypes(q: Q): string[] {
  return q('SELECT type FROM graph_types WHERE ignored = 1').toArray().map((r) => r.type as string);
}

export function teamOnly(q: Q): boolean {
  return q('SELECT value FROM meta WHERE key = ?', TEAM_ONLY).toArray()[0]?.value === '1';
}

export interface Rule { id: string; kind: 'rule' | 'glossary'; term: string | null; text: string; at: string }

export function listRules(q: Q): Rule[] {
  return q('SELECT id, kind, term, text, at FROM graph_rules ORDER BY at').toArray()
    .map((r) => ({ id: r.id as string, kind: r.kind as Rule['kind'], term: (r.term as string | null) ?? null, text: r.text as string, at: r.at as string }));
}

export interface Discarded { kind: 'entity' | 'relation' | 'fact'; key: string; label: string; reason: string | null; at: string }

export function listDiscarded(q: Q, limit: number): Discarded[] {
  return q('SELECT kind, key, label, reason, at FROM graph_tombstones ORDER BY at DESC LIMIT ?', limit).toArray()
    .map((r) => ({ kind: r.kind as Discarded['kind'], key: r.key as string, label: r.label as string, reason: (r.reason as string | null) ?? null, at: r.at as string }));
}

/** Types for the Rules view: the team's own, plus the ones the graph uses today. */
export function schema(q: Q) {
  const team = teamTypes(q);
  const inUse = q('SELECT type, COUNT(*) AS n FROM entities WHERE (mention_count > 0 OR status = ?) GROUP BY type ORDER BY n DESC', CONFIRMED).toArray();
  const counts = new Map(inUse.map((r) => [r.type as string, r.n as number]));
  const types = team.map((t) => ({ ...t, team: true, count: counts.get(t.type) ?? 0 }));
  for (const [type, count] of counts) if (!team.some((t) => t.type === type)) types.push({ type, description: '', ignored: false, team: false, count });
  const relationTypes = q('SELECT type, COUNT(*) AS n FROM relations GROUP BY type ORDER BY n DESC LIMIT 40').toArray().map((r) => r.type as string);
  return { types, teamOnly: teamOnly(q), relationTypes };
}

export interface LogEntry { id: number; at: string; by: string | null; action: string; targets: string[]; detail: Record<string, unknown> }

export function history(q: Q, opts: { entity?: string; limit: number }): LogEntry[] {
  const rows = opts.entity
    ? q('SELECT * FROM graph_log WHERE targets LIKE ? ORDER BY id DESC LIMIT ?', `%"${opts.entity.replace(/[%_"]/g, '')}"%`, opts.limit).toArray()
    : q('SELECT * FROM graph_log ORDER BY id DESC LIMIT ?', opts.limit).toArray();
  return rows.map((r) => ({
    id: r.id as number, at: r.at as string, by: (r.by_user as string | null) ?? null, action: r.action as string,
    targets: json<string[]>(r.targets, []), detail: json<Record<string, unknown>>(r.detail, {}),
  }));
}

/** What the learner is told before every batch, team decisions first. */
export interface LearnerContext {
  known: { name: string; type: string; aliases: string[]; confirmed: boolean }[];
  types: { type: string; description: string }[];
  teamOnly: boolean;
  ignored: string[];
  discarded: string[];
  glossary: { term: string; text: string }[];
  rules: string[];
}

const MAX_CONFIRMED_KNOWN = 80;
const MAX_DISCARDED_SHOWN = 40;

export function learnerContext(q: Q, limit: number): LearnerContext {
  const confirmed = q('SELECT name, type, team_aliases FROM entities WHERE status = ? ORDER BY mention_count DESC LIMIT ?', CONFIRMED, MAX_CONFIRMED_KNOWN).toArray()
    .map((r) => ({ name: r.name as string, type: r.type as string, aliases: json<string[]>(r.team_aliases, []).slice(0, 6), confirmed: true }));
  const ignored = ignoredTypes(q);
  const drafts = q(`SELECT name, type FROM entities WHERE status != ? ORDER BY mention_count DESC LIMIT ?`, CONFIRMED, Math.max(limit - confirmed.length, 10) + ignored.length * 5).toArray()
    .filter((r) => !ignored.includes(r.type as string))
    .slice(0, Math.max(limit - confirmed.length, 10))
    .map((r) => ({ name: r.name as string, type: r.type as string, aliases: [], confirmed: false }));
  const rules = listRules(q);
  return {
    known: [...confirmed, ...drafts],
    types: teamTypes(q).filter((t) => !t.ignored).map(({ type, description }) => ({ type, description })),
    teamOnly: teamOnly(q),
    ignored,
    discarded: q("SELECT label FROM graph_tombstones WHERE kind = 'entity' ORDER BY at DESC LIMIT ?", MAX_DISCARDED_SHOWN).toArray().map((r) => r.label as string),
    glossary: rules.filter((r) => r.kind === 'glossary').map((r) => ({ term: r.term ?? '', text: r.text })),
    rules: rules.filter((r) => r.kind === 'rule').map((r) => r.text),
  };
}

/** The team's decisions applyExtraction checks every extracted item against. */
export interface Guard {
  redirect(norm: string): string | null;
  entityDiscarded(norm: string): boolean;
  relationDiscarded(from: string, type: string, to: string): boolean;
  factDiscarded(entityId: string, predicate: string, value: string): boolean;
  /** False when the team ignores this type, or keeps to its own types and this isn't one. */
  typeAllowed(type: string): boolean;
}

export function guard(q: Q): Guard {
  const norms = new Map<string, string>();
  const norm = (id: string) => { if (!norms.has(id)) norms.set(id, normOf(q, id)); return norms.get(id)!; };
  const redirects = new Map(q('SELECT norm, entity_id FROM graph_redirects').toArray().map((r) => [r.norm as string, r.entity_id as string]));
  const dead = new Set(q('SELECT kind, key FROM graph_tombstones').toArray().map((r) => `${r.kind}:${r.key}`));
  const types = teamTypes(q);
  const ignored = new Set(types.filter((t) => t.ignored).map((t) => t.type));
  const allowed = new Set(types.filter((t) => !t.ignored).map((t) => t.type));
  const only = teamOnly(q) && allowed.size > 0;
  return {
    redirect: (norm) => redirects.get(norm) ?? null,
    entityDiscarded: (norm) => dead.has(`entity:${norm}`),
    relationDiscarded: (from, type, to) => dead.has(`relation:${relKey(norm(from), type, norm(to))}`),
    factDiscarded: (entityId, predicate, value) => dead.has(`fact:${factKey(norm(entityId), predicate, value)}`),
    typeAllowed: (type) => !ignored.has(type) && (!only || allowed.has(type)),
  };
}
