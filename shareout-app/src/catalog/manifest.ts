import type { CatalogEntry, CatalogManifest } from './types';

export interface ManifestOptions {
  nowMs: number;
  staleDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export function buildManifest(entries: CatalogEntry[], opts: ManifestOptions): CatalogManifest {
  const staleDays = opts.staleDays ?? 90;
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const ids = new Set(entries.map(e => e.id));

  const orphans: string[] = [];
  const stale: string[] = [];
  const danglingSet = new Set<string>();

  let documented = 0;
  let owned = 0;
  let certified = 0;
  let certifiable = 0;

  for (const e of entries) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.status) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;

    if (e.body.trim()) documented += 1;
    if (e.owner) owned += 1;

    if (e.kind !== 'term') {
      certifiable += 1;
      if (e.status === 'certified') certified += 1;
    }

    if (e.kind !== 'term' && e.upstream.length === 0 && e.downstream.length === 0) {
      orphans.push(e.id);
    }

    if (e.lastUpdated) {
      const ts = Date.parse(e.lastUpdated);
      if (!Number.isNaN(ts) && opts.nowMs - ts > staleDays * DAY_MS) {
        stale.push(e.id);
      }
    }

    for (const ref of [...e.upstream, ...e.downstream]) {
      if (!ids.has(ref)) danglingSet.add(ref);
    }
  }

  return {
    counts: { entries: entries.length, byKind, byStatus },
    kpis: {
      entries: entries.length,
      documentedPct: pct(documented, entries.length),
      ownedPct: pct(owned, entries.length),
      certifiedPct: pct(certified, certifiable),
      orphans: orphans.length,
      stale: stale.length,
    },
    orphans,
    dangling: [...danglingSet].sort(),
    stale,
    entries: entries.map(e => e.path).sort(),
  };
}
