import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { extractFrontmatter } from './parse';
import {
  CERT_DECISIONS,
  type CatalogEntry,
  type CertDecision,
  type CertificationRecord,
  type CertificationView,
  type EntryStatus,
} from './types';

/**
 * What a metric's certification covers: what it computes and how it is named and shown.
 * The rest of the file — description, synonyms, examples, owner, tags, the notes body —
 * is prose, and editing it keeps the certification. Every other kind is pinned to the
 * whole file.
 */
export const METRIC_SPEC_KEYS = [
  'kind',
  'id',
  'title',
  'title_es',
  'source',
  'type',
  'measure',
  'numerator',
  'denominator',
  'time',
  'dimensions',
  'filters',
  'format',
  'scope_field',
  'freshness_sla',
] as const;

export const MAX_CERT_NOTE_CHARS = 1000;

export function isCertDecision(value: unknown): value is CertDecision {
  return typeof value === 'string' && (CERT_DECISIONS as readonly string[]).includes(value);
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

/** Key-order independent JSON: trimmed strings, blank values dropped, arrays keep order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter(k => !isBlank(obj[k])).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value.trim());
  return JSON.stringify(value) ?? 'null';
}

/** The normalized spec of a metric file — the part its certification is pinned to. */
export function metricSpecPayload(raw: string): Record<string, unknown> {
  const data = extractFrontmatter(raw)?.data ?? {};
  const spec: Record<string, unknown> = {};
  for (const key of METRIC_SPEC_KEYS) if (!isBlank(data[key])) spec[key] = data[key];
  return spec;
}

/** The exact text a certification hash is taken over. */
export function certificationPayload(kind: string, raw: string): string {
  if (kind === 'metric') return `metric-spec:${canonicalJson(metricSpecPayload(raw))}`;
  return raw.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

export async function certificationHash(kind: string, raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(certificationPayload(kind, raw)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Effective status from an entry's decisions (oldest first) and its current hash.
 *
 * - Certified: an owner/admin certified exactly this version, and nobody revoked or
 *   deprecated the entry after that.
 * - Deprecated: the latest decision deprecated it (it sticks across edits), or the file
 *   declares `status: deprecated` (anyone may warn people off an entry).
 * - Otherwise draft. A `status: certified` line in the file never certifies.
 *
 * `stale` marks "changed since certification": the latest certification or deprecation
 * was made on another version of the entry.
 */
export function resolveCertification(
  declared: EntryStatus | undefined,
  hash: string,
  decisions: CertificationRecord[]
): CertificationView {
  const base: EntryStatus = declared === 'deprecated' ? 'deprecated' : 'draft';
  const view = (status: EntryStatus, stale: boolean, decision: CertificationRecord | null): CertificationView => ({
    status,
    declared_status: declared ?? null,
    content_hash: hash,
    stale,
    decision,
  });
  const latest = decisions[decisions.length - 1];
  if (!latest) return view(base, false, null);
  if (latest.decision === 'deprecated') return view('deprecated', latest.content_hash !== hash, latest);
  if (latest.decision === 'revoked') return view(base, false, latest);
  for (let i = decisions.length - 1; i >= 0 && decisions[i].decision === 'certified'; i--) {
    if (decisions[i].content_hash === hash) return view('certified', false, decisions[i]);
  }
  return view(base, true, latest);
}

/** Status for any entry, overlaid or not: a declared `certified` never counts. */
export function effectiveStatus(e: CatalogEntry): EntryStatus {
  return e.certification?.status ?? (e.status === 'deprecated' ? 'deprecated' : 'draft');
}

interface CertificationRow {
  id: string;
  entry_id: string;
  content_hash: string;
  decision: CertDecision;
  note: string | null;
  decided_by: string;
  created_at: string;
  decider_name: string | null;
  decider_email: string | null;
}

function toRecord(r: CertificationRow): CertificationRecord {
  return {
    id: r.id,
    entry_id: r.entry_id,
    content_hash: r.content_hash,
    decision: r.decision,
    note: r.note,
    decided_by: { id: r.decided_by, name: r.decider_name, email: r.decider_email },
    decided_at: r.created_at,
  };
}

/** Every decision in the workspace, oldest first. */
export async function listCertifications(env: Env, workspaceId: string): Promise<CertificationRecord[]> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.entry_id, c.content_hash, c.decision, c.note, c.decided_by, c.created_at,
            u.name AS decider_name, u.email AS decider_email
       FROM catalog_certifications c LEFT JOIN users u ON u.id = c.decided_by
      WHERE c.workspace_id = ?
      ORDER BY c.created_at, c.rowid`
  )
    .bind(workspaceId)
    .all<CertificationRow>();
  return rows.results.map(toRecord);
}

/** Decisions per entry id, filed under the entry's current id when made on an alias. */
export function groupDecisions(
  records: CertificationRecord[],
  aliases: Map<string, string>
): Map<string, CertificationRecord[]> {
  const byEntry = new Map<string, CertificationRecord[]>();
  for (const r of records) {
    const id = aliases.get(r.entry_id) ?? r.entry_id;
    const list = byEntry.get(id) ?? [];
    list.push(r);
    byEntry.set(id, list);
  }
  return byEntry;
}

export async function recordCertification(
  env: Env,
  input: {
    workspaceId: string;
    entryId: string;
    contentHash: string;
    decision: CertDecision;
    note: string | null;
    decidedBy: string;
  }
): Promise<CertificationRecord> {
  const id = generateId('ccert');
  const decidedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO catalog_certifications (id, workspace_id, entry_id, content_hash, decision, note, decided_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, input.workspaceId, input.entryId, input.contentHash, input.decision, input.note, input.decidedBy, decidedAt)
    .run();
  const who = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
    .bind(input.decidedBy)
    .first<{ name: string | null; email: string | null }>();
  return {
    id,
    entry_id: input.entryId,
    content_hash: input.contentHash,
    decision: input.decision,
    note: input.note,
    decided_by: { id: input.decidedBy, name: who?.name ?? null, email: who?.email ?? null },
    decided_at: decidedAt,
  };
}
