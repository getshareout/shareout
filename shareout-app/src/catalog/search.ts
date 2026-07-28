import type { CatalogEntry } from './types';

export interface CatalogQuery {
  q?: string;
  kind?: string;
  domain?: string;
  status?: string;
  tag?: string;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface CatalogFacets {
  kind: FacetValue[];
  domain: FacetValue[];
  status: FacetValue[];
  tag: FacetValue[];
}

function matchesText(entry: CatalogEntry, needle: string): boolean {
  const haystack = [
    entry.id,
    entry.title,
    entry.body,
    entry.domain ?? '',
    entry.fqn ?? '',
    ...entry.tags,
    ...entry.terms,
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(needle);
}

export function searchEntries(entries: CatalogEntry[], query: CatalogQuery): CatalogEntry[] {
  const q = query.q?.trim().toLowerCase();
  return entries.filter(e => {
    if (query.kind && e.kind !== query.kind) return false;
    if (query.domain && e.domain !== query.domain) return false;
    if (query.status && e.status !== query.status) return false;
    if (query.tag && !e.tags.includes(query.tag)) return false;
    if (q && !matchesText(e, q)) return false;
    return true;
  });
}

function tally(values: string[]): FacetValue[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function buildFacets(entries: CatalogEntry[]): CatalogFacets {
  return {
    kind: tally(entries.map(e => e.kind)),
    domain: tally(entries.flatMap(e => (e.domain ? [e.domain] : []))),
    status: tally(entries.flatMap(e => (e.status ? [e.status] : []))),
    tag: tally(entries.flatMap(e => e.tags)),
  };
}
