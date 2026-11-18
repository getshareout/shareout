// Read side of the knowledge graph for people and agents. The store returns every
// source behind each entity/edge/fact; here they're cut down to what the caller may
// see (same rule as search): an item with no visible source doesn't exist for them.
// Names follow the same rule: an entity is shown, and matched, only under names that
// appear in a source the caller may open. What the team confirmed is the exception: it is
// the workspace's own knowledge, shown to every member under the name and aliases the team
// gave it (plus any names the caller's own sources use).
import type { Env } from '../../types';
import { corpusFor, type SourceKind } from './client';
import { visibleSources, type Visible } from './search';
import { normalizeName } from './extract';
import type { EntityName, EntityRow, Ref, RelationRow } from './graph-store';
import { CONFIRMED } from './curation';

export interface SourceCite { kind: SourceKind; id: string; title: string; url: string | null }

type Store = NonNullable<ReturnType<typeof corpusFor>>;

async function visibility(env: Env, workspaceId: string, userId: string, refs: Ref[]) {
  const { visible } = await visibleSources(env, workspaceId, userId, refs);
  const cite = (r: Ref): SourceCite | null => {
    const v: Visible | undefined = visible.get(r.refId);
    return v ? { kind: r.kind, id: r.refId, title: v.title, url: v.url } : null;
  };
  const sources = (refs: Ref[]) => {
    const seen = new Set<string>();
    return refs.filter((r) => !seen.has(r.refId) && seen.add(r.refId)).map(cite).filter((c): c is SourceCite => !!c);
  };
  // The entity's own name when a visible source uses it, else the first name one does; null
  // when no source the caller may open names it at all.
  const naming = (e: { name: string; names: EntityName[]; status?: string; teamAliases?: string[] }): { name: string; aliases: string[] } | null => {
    const shown = [...new Set(e.names.filter((n) => visible.has(n.ref.refId)).map((n) => n.name))];
    if (isTeam(e)) return { name: e.name, aliases: [...new Set([...(e.teamAliases ?? []), ...shown])].filter((a) => a !== e.name) };
    if (!shown.length) return null;
    const name = shown.includes(e.name) ? e.name : shown[0];
    return { name, aliases: shown.filter((a) => a !== name) };
  };
  return { cite, sources, naming };
}

type Naming = { name: string; aliases: string[] };

const isTeam = (e: { status?: string }) => e.status === CONFIRMED;

/** A fact as readers get it: `source` is null for one the team added. */
type FactOut = { id: string; predicate: string; value: string; unit: string | null; validFrom: string | null; quote: string; source: SourceCite | null; status: string };

/** Every source behind an entity: the ones its mentions cite and the ones its names appear in. */
const entityRefs = (e: EntityRow) => [...e.refs, ...e.names.map((n) => n.ref)];

const entityOut = (e: EntityRow, sources: SourceCite[], naming: Naming) => ({
  id: e.id, type: e.type, name: naming.name, aliases: naming.aliases, status: isTeam(e) ? CONFIRMED : 'draft', mentions: e.mentions, sources: sources.slice(0, 5),
  description: e.description, teamAliases: e.teamAliases, confirmedAt: e.confirmedAt,
});

const matches = (naming: Naming, q: string) => {
  const nq = normalizeName(q);
  const lq = q.toLowerCase();
  return [naming.name, ...naming.aliases].some((n) => (nq && normalizeName(n).includes(nq)) || n.toLowerCase().includes(lq));
};

export async function listVisibleEntities(env: Env, store: Store, workspaceId: string, userId: string, opts: { type?: string; q?: string; status?: 'confirmed' | 'draft'; limit: number }) {
  const { types, entities } = await store.listEntities({ ...opts, limit: Math.min(opts.limit * 2, 200) });
  const v = await visibility(env, workspaceId, userId, entities.flatMap(entityRefs));
  return {
    types,
    entities: entities
      .map((e) => ({ e, s: v.sources(entityRefs(e)), n: v.naming(e) }))
      // The store matched `q` against every name; keep the entity only if a name the caller
      // may see matches, so a search can't confirm a name that only a hidden source uses.
      .filter((x): x is { e: EntityRow; s: SourceCite[]; n: Naming } => (!!x.s.length || isTeam(x.e)) && !!x.n && (!opts.q || matches(x.n, opts.q)))
      .slice(0, opts.limit)
      .map((x) => entityOut(x.e, x.s, x.n)),
  };
}

export async function visibleEntity(env: Env, store: Store, workspaceId: string, userId: string, id: string) {
  const g = await store.getEntity(id);
  if (!g) return null;
  const v = await visibility(env, workspaceId, userId, [
    ...entityRefs(g.entity), ...g.facts.flatMap((f) => (f.ref ? [f.ref] : [])), ...g.mentions.map((m) => m.ref),
    ...g.relations.flatMap((r) => [...r.refs, ...r.other.names.map((n) => n.ref)]),
  ]);
  const sources = v.sources(entityRefs(g.entity));
  const naming = v.naming(g.entity);
  if ((!sources.length && !isTeam(g.entity)) || !naming) return null;
  return {
    entity: entityOut(g.entity, sources, naming),
    facts: g.facts.flatMap((f): FactOut[] => {
      // A team fact has no source; a learned one shows only with a source the caller may open.
      if (f.status === CONFIRMED) return [{ id: f.id, predicate: f.predicate, value: f.value, unit: f.unit, validFrom: f.validFrom, quote: '', source: null, status: CONFIRMED }];
      const source = f.ref ? v.cite(f.ref) : null;
      return source ? [{ id: f.id, predicate: f.predicate, value: f.value, unit: f.unit, validFrom: f.validFrom, quote: f.quote, source, status: 'draft' }] : [];
    }),
    relations: g.relations.flatMap((r) => {
      const s = v.sources(r.refs);
      const other = v.naming(r.other);
      return (s.length || isTeam(r)) && other
        ? [{ id: r.id, type: r.type, direction: r.direction, status: isTeam(r) ? CONFIRMED : 'draft', other: { id: r.other.id, name: other.name, type: r.other.type, status: isTeam(r.other) ? CONFIRMED : 'draft' }, mentions: r.mentions, sources: s.slice(0, 3) }]
        : [];
    }),
    mentions: g.mentions.flatMap((m) => {
      const source = v.cite(m.ref);
      return source ? [{ quote: m.quote, locator: m.locator, source, cite: m.locator ? `${source.title} — ${m.locator}` : source.title }] : [];
    }),
  };
}

export async function visibleGraph(env: Env, store: Store, workspaceId: string, userId: string, opts: { focus?: string; depth: number; limit: number }) {
  const { nodes, edges } = await store.graph(opts);
  const v = await visibility(env, workspaceId, userId, [...nodes.flatMap(entityRefs), ...edges.flatMap((e) => e.refs)]);
  const kept = new Map<string, ReturnType<typeof entityOut>>();
  for (const n of nodes) {
    const s = v.sources(entityRefs(n));
    const naming = v.naming(n);
    if ((s.length || isTeam(n)) && naming) kept.set(n.id, entityOut(n, s, naming));
  }
  const edgeOut = (e: RelationRow) => ({ id: e.id, from: e.from, to: e.to, type: e.type, mentions: e.mentions, status: isTeam(e) ? CONFIRMED : 'draft' });
  return {
    nodes: [...kept.values()],
    edges: edges.filter((e) => kept.has(e.from) && kept.has(e.to) && (isTeam(e) || v.sources(e.refs).length)).map(edgeOut),
  };
}

type EntityView = NonNullable<Awaited<ReturnType<typeof visibleEntity>>>;

/** Compact markdown of one entity for LLM context (`?format=md`). */
export function entityMarkdown(x: EntityView): string {
  const e = x.entity;
  const lines = [`# ${e.name} (${e.type})${e.aliases.length ? ` — also: ${e.aliases.filter((a) => a !== e.name).join(', ')}` : ''}`];
  if (isTeam(e)) lines.push('', 'Confirmed by the workspace team — prefer what it says over anything learned below.');
  if (e.description) lines.push('', e.description);
  if (x.facts.length) {
    lines.push('', '## Facts');
    for (const f of x.facts) {
      const unit = f.unit ? ` ${f.unit}` : '', from = f.validFrom ? ` (from ${f.validFrom})` : '';
      lines.push(f.source ? `- ${f.predicate}: ${f.value}${unit}${from} — "${f.quote}" [${f.source.title}]` : `- ${f.predicate}: ${f.value}${unit}${from} [team]`);
    }
  }
  if (x.relations.length) {
    lines.push('', '## Connections');
    for (const r of x.relations) {
      lines.push(r.direction === 'out' ? `- ${e.name} ${r.type} ${r.other.name} (${r.other.type})` : `- ${r.other.name} (${r.other.type}) ${r.type} ${e.name}`);
    }
  }
  if (x.mentions.length) {
    lines.push('', '## Mentions');
    for (const m of x.mentions.slice(0, 15)) lines.push(`- "${m.quote}" [${m.cite}]`);
  }
  return lines.join('\n');
}
