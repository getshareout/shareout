import { parse as parseYaml } from 'yaml';
import {
  ENTRY_KINDS,
  ENTRY_STATUSES,
  type CatalogEntry,
  type EntryKind,
  type EntryStatus,
  type ParseIssue,
  type ParseResult,
} from './types';

export interface CatalogFile {
  path: string;
  content: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const KNOWN_KEYS = new Set([
  'kind',
  'id',
  'title',
  'domain',
  'status',
  'owner',
  'tags',
  'terms',
  'upstream',
  'downstream',
  'aspects',
  'connection',
  'fqn',
  'artifact',
  'store',
  'last_updated',
]);

export function extractFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch {
    // Malformed YAML in one entry must never break the whole catalog load —
    // treat it as missing frontmatter so the file becomes a parse issue, skipped.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return { data: parsed as Record<string, unknown>, body: (match[2] ?? '').trim() };
}

function toStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
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

export function parseEntry(
  path: string,
  raw: string
): { entry?: CatalogEntry; issue?: ParseIssue } {
  const fm = extractFrontmatter(raw);
  if (!fm) {
    return { issue: { path, message: 'missing or malformed frontmatter' } };
  }
  const { data, body } = fm;

  const kind = optionalString(data.kind);
  const id = optionalString(data.id);
  const title = optionalString(data.title);

  if (!kind) return { issue: { path, message: 'missing required field: kind' } };
  if (!id) return { issue: { path, message: 'missing required field: id' } };
  if (!title) return { issue: { path, message: 'missing required field: title' } };
  if (!ENTRY_KINDS.includes(kind as EntryKind)) {
    return { issue: { path, message: `unknown kind: ${kind}` } };
  }

  const status = optionalString(data.status);
  if (status && !ENTRY_STATUSES.includes(status as EntryStatus)) {
    return { issue: { path, message: `unknown status: ${status}` } };
  }

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
  }

  return {
    entry: {
      kind: kind as EntryKind,
      id,
      title,
      domain: optionalString(data.domain),
      status: status as EntryStatus | undefined,
      owner: optionalString(data.owner),
      tags: toStringList(data.tags),
      terms: toStringList(data.terms),
      upstream: toStringList(data.upstream),
      downstream: toStringList(data.downstream),
      aspects: toStringList(data.aspects),
      connection: optionalString(data.connection),
      fqn: optionalString(data.fqn),
      artifact: optionalString(data.artifact),
      store: optionalString(data.store),
      lastUpdated: optionalString(data.last_updated),
      body,
      path,
      extra,
    },
  };
}

export function parseCatalog(files: CatalogFile[]): ParseResult {
  const entries: CatalogEntry[] = [];
  const issues: ParseIssue[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    if (!file.path.toLowerCase().endsWith('.md')) continue;
    const { entry, issue } = parseEntry(file.path, file.content);
    if (issue) {
      issues.push(issue);
      continue;
    }
    if (!entry) continue;
    const prior = seen.get(entry.id);
    if (prior) {
      issues.push({ path: file.path, message: `duplicate id: ${entry.id} (also ${prior})` });
      continue;
    }
    seen.set(entry.id, file.path);
    entries.push(entry);
  }

  return { entries, issues };
}
