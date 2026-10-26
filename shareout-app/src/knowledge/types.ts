export const NODE_KINDS = [
  'artifact-digest',
  'topic',
  'entity',
  'decision',
  'timeline',
  'overview',
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const CONFIDENCE_TIERS = ['extracted', 'inferred'] as const;
export type Confidence = (typeof CONFIDENCE_TIERS)[number];

export interface KnowledgeNode {
  kind: NodeKind;
  id: string;
  title: string;
  path: string;
  topics: string[];
  entities: string[];
  sources: string[];
  confidence?: Confidence;
  learnedAt?: string;
  staleAfter?: string;
  pinned: boolean;
  body: string;
  extra: Record<string, unknown>;
}

export interface ParseIssue {
  path: string;
  message: string;
}

export interface ParseResult {
  nodes: KnowledgeNode[];
  issues: ParseIssue[];
}

export function artifactDigestPath(artifactId: string): string {
  return `artifacts/${artifactId}.md`;
}

export function topicPath(slug: string): string {
  return `topics/${slug}.md`;
}

export function entityPath(slug: string): string {
  return `entities/${slug}.md`;
}

export function timelinePath(yyyyMm: string): string {
  return `timeline/${yyyyMm}.md`;
}

// Inverse of artifactDigestPath: 'artifacts/<id>.md' -> '<id>'. The consolidator
// prune SQL derives the same id in SQLite; this keeps the JS side off inline slicing.
// Guarded: a non-'artifacts/' path (entity/topic page fed through a digest slot)
// would mis-slice into a garbage id, so return '' — callers dedupe/filter it out.
export function artifactIdFromDigestPath(path: string): string {
  if (!path.startsWith('artifacts/')) return '';
  return path.slice('artifacts/'.length, -'.md'.length);
}

export const INDEX_PATH = 'index.md';

// A learned note's `sources` decide who may read it, so they must name every page the note
// was built from. Notes written since that holds say `provenance: full`; older topic, entity
// and timeline notes kept only their newest 50 sources, and older overviews listed none.
export const PROVENANCE_LINE = 'provenance: full';
export const LEGACY_SOURCES_CAP = 50;

export function hasFullProvenance(node: { extra: Record<string, unknown> }): boolean {
  return node.extra.provenance === 'full';
}

/** A learned (not hand-written) note whose sources may be incomplete. */
export function provenanceIncomplete(node: { kind: string; sources: string[]; extra: Record<string, unknown> }): boolean {
  return !hasFullProvenance(node) && (node.kind === 'overview' || node.sources.length >= LEGACY_SOURCES_CAP);
}
