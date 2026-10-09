// Read side of the knowledge graph for people and agents. The store returns every
// source behind each entity/edge/fact; here they're cut down to what the caller may
// see (same rule as search): an item with no visible source doesn't exist for them.
import type { Env } from '../../types';
import { corpusFor, type SourceKind } from './client';
import { visibleSources, type Visible } from './search';
import type { EntityRow, Ref, RelationRow } from './graph-store';

export interface SourceCite { kind: SourceKind; id: string; title: string; url: string | null }

type Store = NonNullable<ReturnType<typeof corpusFor>>;

async function visibility(env: Env, workspaceId: string, userId: string, refs: Ref[]) {
  const { visible } = await visibleSources(env, workspaceId, userId, refs);
  const cite = (r: Ref): SourceCite | null => {
    const v: Visible | undefined = visible.get(r.refId);
    return v ? { kind: r.kind, id: r.refId, title: v.title, url: v.url } : null;
  };
  const sources = (refs: Ref[]) => refs.map(cite).filter((c): c is SourceCite => !!c);
  return { cite, sources };
}

const entityOut = (e: EntityRow, sources: SourceCite[]) => ({
  id: e.id, type: e.type, name: e.name, aliases: e.aliases, status: e.status, mentions: e.mentions, sources: sources.slice(0, 5),
});

export async function listVisibleEntities(env: Env, store: Store, workspaceId: string, userId: string, opts: { type?: string; q?: string; limit: number }) {
  const { types, entities } = await store.listEntities({ ...opts, limit: Math.min(opts.limit * 2, 200) });
  const v = await visibility(env, workspaceId, userId, entities.flatMap((e) => e.refs));
  return {
    types,
    entities: entities
      .map((e) => ({ e, s: v.sources(e.refs) }))
      .filter((x) => x.s.length)
      .slice(0, opts.limit)
      .map((x) => entityOut(x.e, x.s)),
  };
}

export async function visibleEntity(env: Env, store: Store, workspaceId: string, userId: string, id: string) {
  const g = await store.getEntity(id);
  if (!g) return null;
  const v = await visibility(env, workspaceId, userId, [
    ...g.entity.refs, ...g.facts.map((f) => f.ref), ...g.mentions.map((m) => m.ref), ...g.relations.flatMap((r) => r.refs),
  ]);
  const sources = v.sources(g.entity.refs);
  if (!sources.length) return null;
  return {
    entity: entityOut(g.entity, sources),
    facts: g.facts.flatMap((f) => {
      const source = v.cite(f.ref);
      return source ? [{ id: f.id, predicate: f.predicate, value: f.value, unit: f.unit, validFrom: f.validFrom, quote: f.quote, source }] : [];
    }),
    relations: g.relations.flatMap((r) => {
      const s = v.sources(r.refs);
      return s.length ? [{ id: r.id, type: r.type, direction: r.direction, other: r.other, mentions: r.mentions, sources: s.slice(0, 3) }] : [];
    }),
    mentions: g.mentions.flatMap((m) => {
      const source = v.cite(m.ref);
      return source ? [{ quote: m.quote, locator: m.locator, source, cite: m.locator ? `${source.title} — ${m.locator}` : source.title }] : [];
    }),
  };
}

export async function visibleGraph(env: Env, store: Store, workspaceId: string, userId: string, opts: { focus?: string; depth: number; limit: number }) {
  const { nodes, edges } = await store.graph(opts);
  const v = await visibility(env, workspaceId, userId, [...nodes.flatMap((n) => n.refs), ...edges.flatMap((e) => e.refs)]);
  const kept = new Map(nodes.map((n) => [n.id, v.sources(n.refs)] as const).filter(([, s]) => s.length));
  const edgeOut = (e: RelationRow) => ({ id: e.id, from: e.from, to: e.to, type: e.type, mentions: e.mentions });
  return {
    nodes: nodes.filter((n) => kept.has(n.id)).map((n) => entityOut(n, kept.get(n.id)!)),
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
