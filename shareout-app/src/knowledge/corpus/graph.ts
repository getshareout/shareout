// Read side of the knowledge graph for people and agents. The store returns every
// source behind each entity/edge/fact; here they're cut down to what the caller may
// see (same rule as search): an item with no visible source doesn't exist for them.
// Names follow the same rule: an entity is shown, and matched, only under names that
// appear in a source the caller may open.
import type { Env } from '../../types';
import { corpusFor, type SourceKind } from './client';
import { visibleSources, type Visible } from './search';
import { normalizeName } from './extract';
import type { EntityName, EntityRow, Ref, RelationRow } from './graph-store';

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
  const naming = (e: { name: string; names: EntityName[] }): { name: string; aliases: string[] } | null => {
    const shown = [...new Set(e.names.filter((n) => visible.has(n.ref.refId)).map((n) => n.name))];
    if (!shown.length) return null;
    const name = shown.includes(e.name) ? e.name : shown[0];
    return { name, aliases: shown.filter((a) => a !== name) };
  };
  return { cite, sources, naming };
}

type Naming = { name: string; aliases: string[] };

/** Every source behind an entity: the ones its mentions cite and the ones its names appear in. */
const entityRefs = (e: EntityRow) => [...e.refs, ...e.names.map((n) => n.ref)];

const entityOut = (e: EntityRow, sources: SourceCite[], naming: Naming) => ({
  id: e.id, type: e.type, name: naming.name, aliases: naming.aliases, status: e.status, mentions: e.mentions, sources: sources.slice(0, 5),
});

const matches = (naming: Naming, q: string) => {
  const nq = normalizeName(q);
  const lq = q.toLowerCase();
  return [naming.name, ...naming.aliases].some((n) => (nq && normalizeName(n).includes(nq)) || n.toLowerCase().includes(lq));
};

export async function listVisibleEntities(env: Env, store: Store, workspaceId: string, userId: string, opts: { type?: string; q?: string; limit: number }) {
  const { types, entities } = await store.listEntities({ ...opts, limit: Math.min(opts.limit * 2, 200) });
  const v = await visibility(env, workspaceId, userId, entities.flatMap(entityRefs));
  return {
    types,
    entities: entities
      .map((e) => ({ e, s: v.sources(entityRefs(e)), n: v.naming(e) }))
      // The store matched `q` against every name; keep the entity only if a name the caller
      // may see matches, so a search can't confirm a name that only a hidden source uses.
      .filter((x): x is { e: EntityRow; s: SourceCite[]; n: Naming } => !!x.s.length && !!x.n && (!opts.q || matches(x.n, opts.q)))
      .slice(0, opts.limit)
      .map((x) => entityOut(x.e, x.s, x.n)),
  };
}

export async function visibleEntity(env: Env, store: Store, workspaceId: string, userId: string, id: string) {
  const g = await store.getEntity(id);
  if (!g) return null;
  const v = await visibility(env, workspaceId, userId, [
    ...entityRefs(g.entity), ...g.facts.map((f) => f.ref), ...g.mentions.map((m) => m.ref),
    ...g.relations.flatMap((r) => [...r.refs, ...r.other.names.map((n) => n.ref)]),
  ]);
  const sources = v.sources(entityRefs(g.entity));
  const naming = v.naming(g.entity);
  if (!sources.length || !naming) return null;
  return {
    entity: entityOut(g.entity, sources, naming),
    facts: g.facts.flatMap((f) => {
      const source = v.cite(f.ref);
      return source ? [{ id: f.id, predicate: f.predicate, value: f.value, unit: f.unit, validFrom: f.validFrom, quote: f.quote, source }] : [];
    }),
    relations: g.relations.flatMap((r) => {
      const s = v.sources(r.refs);
      const other = v.naming(r.other);
      return s.length && other
        ? [{ id: r.id, type: r.type, direction: r.direction, other: { id: r.other.id, name: other.name, type: r.other.type }, mentions: r.mentions, sources: s.slice(0, 3) }]
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
    if (s.length && naming) kept.set(n.id, entityOut(n, s, naming));
  }
  const edgeOut = (e: RelationRow) => ({ id: e.id, from: e.from, to: e.to, type: e.type, mentions: e.mentions });
  return {
    nodes: [...kept.values()],
    edges: edges.filter((e) => kept.has(e.from) && kept.has(e.to) && v.sources(e.refs).length).map(edgeOut),
  };
}

type EntityView = NonNullable<Awaited<ReturnType<typeof visibleEntity>>>;

/** Compact markdown of one entity for LLM context (`?format=md`). */
export function entityMarkdown(x: EntityView): string {
  const e = x.entity;
  const lines = [`# ${e.name} (${e.type})${e.aliases.length ? ` — also: ${e.aliases.filter((a) => a !== e.name).join(', ')}` : ''}`];
  if (x.facts.length) {
    lines.push('', '## Facts');
    for (const f of x.facts) lines.push(`- ${f.predicate}: ${f.value}${f.unit ? ` ${f.unit}` : ''}${f.validFrom ? ` (from ${f.validFrom})` : ''} — "${f.quote}" [${f.source.title}]`);
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
