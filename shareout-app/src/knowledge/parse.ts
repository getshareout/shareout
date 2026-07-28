import {
  NODE_KINDS,
  CONFIDENCE_TIERS,
  type Confidence,
  type KnowledgeNode,
  type NodeKind,
  type ParseIssue,
  type ParseResult,
} from './types';
// extractFrontmatter mirrors src/catalog/parse.ts (same md+YAML family); imported
// directly so the malformed-YAML-never-throws rule stays single-sourced.
import { extractFrontmatter } from '../catalog/parse';

export interface KnowledgeFile {
  path: string;
  content: string;
}

const KNOWN_KEYS = new Set([
  'kind',
  'id',
  'title',
  'topics',
  'entities',
  'sources',
  'confidence',
  'learned_at',
  'stale_after',
  'pinned',
]);

function toStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

export function parseNode(
  path: string,
  raw: string
): { node?: KnowledgeNode; issue?: ParseIssue } {
  const fm = extractFrontmatter(raw);
  if (!fm) return { issue: { path, message: 'missing or malformed frontmatter' } };
  const { data, body } = fm;

  const kind = optionalString(data.kind);
  const id = optionalString(data.id);
  const title = optionalString(data.title);

  if (!kind) return { issue: { path, message: 'missing required field: kind' } };
  if (!id) return { issue: { path, message: 'missing required field: id' } };
  if (!title) return { issue: { path, message: 'missing required field: title' } };
  if (!NODE_KINDS.includes(kind as NodeKind)) {
    return { issue: { path, message: `unknown kind: ${kind}` } };
  }

  const confidence = optionalString(data.confidence);
  if (confidence && !CONFIDENCE_TIERS.includes(confidence as Confidence)) {
    return { issue: { path, message: `unknown confidence: ${confidence}` } };
  }

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
  }

  return {
    node: {
      kind: kind as NodeKind,
      id,
      title,
      path,
      topics: toStringList(data.topics),
      entities: toStringList(data.entities),
      sources: toStringList(data.sources),
      confidence: confidence as Confidence | undefined,
      learnedAt: optionalString(data.learned_at),
      staleAfter: optionalString(data.stale_after),
      pinned: data.pinned === true || String(data.pinned).trim() === 'true',
      body,
      extra,
    },
  };
}

export function parseKnowledge(files: KnowledgeFile[]): ParseResult {
  const nodes: KnowledgeNode[] = [];
  const issues: ParseIssue[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    if (!file.path.toLowerCase().endsWith('.md')) continue;
    const { node, issue } = parseNode(file.path, file.content);
    if (issue) {
      issues.push(issue);
      continue;
    }
    if (!node) continue;
    const prior = seen.get(node.id);
    if (prior) {
      issues.push({ path: file.path, message: `duplicate id: ${node.id} (also ${prior})` });
      continue;
    }
    seen.set(node.id, file.path);
    nodes.push(node);
  }

  return { nodes, issues };
}
