export const ENTRY_KINDS = [
  'source',
  'event',
  'dataset',
  'table',
  'view',
  'pipeline',
  'dashboard',
  'model',
  'metric',
  'term',
] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

export const ENTRY_STATUSES = ['draft', 'certified', 'deprecated'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export interface CatalogEntry {
  kind: EntryKind;
  id: string;
  title: string;
  path: string;
  domain?: string;
  status?: EntryStatus;
  owner?: string;
  tags: string[];
  terms: string[];
  upstream: string[];
  downstream: string[];
  aspects: string[];
  connection?: string;
  fqn?: string;
  artifact?: string;
  store?: string;
  lastUpdated?: string;
  body: string;
  extra: Record<string, unknown>;
}

export interface ParseIssue {
  path: string;
  message: string;
}

export interface ParseResult {
  entries: CatalogEntry[];
  issues: ParseIssue[];
}

export interface LineageNode {
  id: string;
  kind?: EntryKind;
  title?: string;
  present: boolean;
}

export interface LineageEdge {
  from: string;
  to: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface CatalogKpis {
  entries: number;
  documentedPct: number;
  ownedPct: number;
  certifiedPct: number;
  orphans: number;
  stale: number;
}

export interface CatalogManifest {
  counts: {
    entries: number;
    byKind: Record<string, number>;
    byStatus: Record<string, number>;
  };
  kpis: CatalogKpis;
  orphans: string[];
  dangling: string[];
  stale: string[];
  entries: string[];
}
