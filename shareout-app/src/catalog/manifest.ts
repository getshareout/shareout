import type { CatalogEntry, CatalogManifest } from './types';
import { buildLineage } from './lineage';
import { effectiveStatus } from './certification';

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
  // Lineage from both ends of every edge (aliases resolved): an entry only its
  // neighbors point at is linked, not an orphan.
  const graph = buildLineage(entries);
  const linked = new Set(graph.edges.flatMap(edge => [edge.from, edge.to]));

  const orphans: string[] = [];
  const stale: string[] = [];

  let documented = 0;
  let owned = 0;
  let certified = 0;
  let certifiable = 0;

  for (const e of entries) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    const status = effectiveStatus(e);
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    if (e.body.trim()) documented += 1;
    if (e.owner) owned += 1;

    if (e.kind !== 'term') {
      certifiable += 1;
      if (status === 'certified') certified += 1;
    }

    if (e.kind !== 'term' && !linked.has(e.id)) orphans.push(e.id);

    if (e.lastUpdated) {
      const ts = Date.parse(e.lastUpdated);
      if (!Number.isNaN(ts) && opts.nowMs - ts > staleDays * DAY_MS) {
        stale.push(e.id);
      }
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
    dangling: graph.nodes.filter(n => !n.present).map(n => n.id).sort(),
    stale,
    entries: entries.map(e => e.path).sort(),
  };
}
