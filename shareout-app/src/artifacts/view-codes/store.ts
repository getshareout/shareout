// One-time view codes (migration 0036): a page opened with "link + a personal code"
// instead of a sign-in. A code opens the page once, for view_seconds, then never again.
import type { Env } from '../../types';
import { generateId, sha256 } from '../../crypto-utils';

export const VIEW_SECONDS_DEFAULT = 90;
export const VIEW_SECONDS_MIN = 10;
export const VIEW_SECONDS_MAX = 600;
export const MAX_CODES_PER_REQUEST = 100;
export const MAX_CODES_PER_ARTIFACT = 1000;
export const MAX_LABEL_LENGTH = 80;
/** Events kept per code — a page open for two minutes has no business sending more. */
export const MAX_EVENTS_PER_CODE = 50;

// No 0/O or 1/I: the code is read off a phone and typed on another.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export const VIEW_CODE_EVENT_KINDS = [
  'copy', 'print', 'save', 'context_menu', 'screenshot_key', 'left_page',
] as const;
export type ViewCodeEventKind = typeof VIEW_CODE_EVENT_KINDS[number];

export function isViewCodeEventKind(v: unknown): v is ViewCodeEventKind {
  return typeof v === 'string' && (VIEW_CODE_EVENT_KINDS as readonly string[]).includes(v);
}

/** A fresh code, `XXXX-XXXX` (32^8 ≈ 10^12 — unguessable behind the gate's rate limit). */
export function generateViewCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** What the visitor typed → the canonical 8 characters, or null if it can't be a code. */
export function normalizeViewCode(input: string | null | undefined): string | null {
  const s = (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

/** Codes are high-entropy and single-use, so a keyed SHA-256 is enough (no PBKDF2). */
export async function hashViewCode(artifactId: string, normalized: string): Promise<string> {
  return sha256(new TextEncoder().encode(`view-code:${artifactId}:${normalized}`).buffer as ArrayBuffer);
}

/** Seconds a code keeps the page open: the default when unset, else an integer in range. */
export function parseViewSeconds(raw: unknown): number | { error: string } {
  if (raw === undefined || raw === null || raw === '') return VIEW_SECONDS_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < VIEW_SECONDS_MIN || n > VIEW_SECONDS_MAX) {
    return { error: `view_seconds must be a whole number from ${VIEW_SECONDS_MIN} to ${VIEW_SECONDS_MAX}` };
  }
  return n;
}

/** The watermark text: trimmed, single-line, bounded. */
export function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, MAX_LABEL_LENGTH);
}

export interface CreatedViewCode {
  id: string;
  label: string;
  code: string;
  view_seconds: number;
  created_at: string;
}

export async function createViewCodes(
  env: Env,
  artifactId: string,
  labels: string[],
  viewSeconds: number,
  createdBy: string,
): Promise<CreatedViewCode[]> {
  const createdAt = new Date().toISOString();
  const out: CreatedViewCode[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const label of labels) {
    const code = generateViewCode();
    const id = generateId('vcd');
    const hash = await hashViewCode(artifactId, normalizeViewCode(code)!);
    stmts.push(env.DB.prepare(
      `INSERT INTO artifact_view_codes (id, artifact_id, label, code_hash, view_seconds, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, artifactId, label, hash, viewSeconds, createdBy, createdAt));
    out.push({ id, label, code, view_seconds: viewSeconds, created_at: createdAt });
  }
  if (stmts.length) await env.DB.batch(stmts);
  return out;
}

export async function countViewCodes(env: Env, artifactId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM artifact_view_codes WHERE artifact_id = ?')
    .bind(artifactId).first<{ n: number }>();
  return row?.n ?? 0;
}

export type ViewCodeStatus = 'unused' | 'open' | 'viewed' | 'revoked';

export interface ViewCodeSummary {
  id: string;
  label: string;
  view_seconds: number;
  status: ViewCodeStatus;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
  opened_device: string | null;
  revoked_at: string | null;
  /** What the viewer tried while it was open, by kind. */
  attempts: Partial<Record<ViewCodeEventKind, number>>;
}

interface ViewCodeRow {
  id: string;
  label: string;
  view_seconds: number;
  created_at: string;
  opened_at: string | null;
  opened_device: string | null;
  revoked_at: string | null;
}

export function closesAt(row: { opened_at: string | null; view_seconds: number }): number | null {
  return row.opened_at ? Date.parse(row.opened_at) + row.view_seconds * 1000 : null;
}

function statusOf(row: ViewCodeRow, now: number): ViewCodeStatus {
  if (row.opened_at) return !row.revoked_at && (closesAt(row) ?? 0) > now ? 'open' : 'viewed';
  return row.revoked_at ? 'revoked' : 'unused';
}

export async function listViewCodes(env: Env, artifactId: string): Promise<ViewCodeSummary[]> {
  const [codes, events] = await Promise.all([
    env.DB.prepare(
      `SELECT id, label, view_seconds, created_at, opened_at, opened_device, revoked_at
         FROM artifact_view_codes WHERE artifact_id = ? ORDER BY created_at DESC, label`,
    ).bind(artifactId).all<ViewCodeRow>(),
    env.DB.prepare(
      `SELECT e.code_id, e.kind, COUNT(*) AS n
         FROM artifact_view_code_events e JOIN artifact_view_codes c ON c.id = e.code_id
        WHERE c.artifact_id = ? GROUP BY e.code_id, e.kind`,
    ).bind(artifactId).all<{ code_id: string; kind: string; n: number }>(),
  ]);
  const attempts = new Map<string, Partial<Record<ViewCodeEventKind, number>>>();
  for (const e of events.results || []) {
    if (!isViewCodeEventKind(e.kind)) continue;
    const m = attempts.get(e.code_id) ?? {};
    m[e.kind] = e.n;
    attempts.set(e.code_id, m);
  }
  const now = Date.now();
  return (codes.results || []).map((r) => {
    const end = closesAt(r);
    return {
      id: r.id,
      label: r.label,
      view_seconds: r.view_seconds,
      status: statusOf(r, now),
      created_at: r.created_at,
      opened_at: r.opened_at,
      closed_at: end !== null && end <= now ? new Date(end).toISOString() : null,
      opened_device: r.opened_device,
      revoked_at: r.revoked_at,
      attempts: attempts.get(r.id) ?? {},
    };
  });
}

/** Revoke one unused code. Returns false when there is no such code on this page. */
export async function revokeViewCode(env: Env, artifactId: string, codeId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM artifact_view_codes WHERE id = ? AND artifact_id = ?')
    .bind(codeId, artifactId).first<{ id: string }>();
  if (!row) return false;
  await env.DB.prepare(
    'UPDATE artifact_view_codes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  ).bind(new Date().toISOString(), codeId).run();
  return true;
}

export async function revokeAllViewCodes(env: Env, artifactId: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE artifact_view_codes SET revoked_at = ? WHERE artifact_id = ? AND revoked_at IS NULL',
  ).bind(new Date().toISOString(), artifactId).run();
}

export type RedeemResult =
  | { ok: true; codeId: string; label: string; openedAt: string; viewSeconds: number }
  | { ok: false; reason: 'invalid' | 'used' };

/**
 * Spend a code. The UPDATE is the whole check — `opened_at IS NULL` makes it single-use
 * even when two devices submit the same code at once (exactly one row update wins).
 */
export async function redeemViewCode(
  env: Env,
  artifactId: string,
  typed: string,
  device: string,
): Promise<RedeemResult> {
  const normalized = normalizeViewCode(typed);
  if (!normalized) return { ok: false, reason: 'invalid' };
  const hash = await hashViewCode(artifactId, normalized);
  const openedAt = new Date().toISOString();
  const won = await env.DB.prepare(
    `UPDATE artifact_view_codes SET opened_at = ?, opened_device = ?
      WHERE artifact_id = ? AND code_hash = ? AND opened_at IS NULL AND revoked_at IS NULL
      RETURNING id, label, view_seconds`,
  ).bind(openedAt, device, artifactId, hash).first<{ id: string; label: string; view_seconds: number }>();
  if (won) return { ok: true, codeId: won.id, label: won.label, openedAt, viewSeconds: won.view_seconds };
  const exists = await env.DB.prepare('SELECT 1 FROM artifact_view_codes WHERE artifact_id = ? AND code_hash = ?')
    .bind(artifactId, hash).first();
  return { ok: false, reason: exists ? 'used' : 'invalid' };
}

export interface LiveViewCode {
  id: string;
  label: string;
  openedAt: string;
  /** Epoch ms the page closes for this viewer. */
  closesAt: number;
}

/** A redeemed code whose window is still open and that nobody revoked since. */
export async function getLiveViewCode(env: Env, artifactId: string, codeId: string): Promise<LiveViewCode | null> {
  const row = await env.DB.prepare(
    `SELECT id, label, view_seconds, opened_at, revoked_at FROM artifact_view_codes
      WHERE id = ? AND artifact_id = ?`,
  ).bind(codeId, artifactId).first<{ id: string; label: string; view_seconds: number; opened_at: string | null; revoked_at: string | null }>();
  if (!row || !row.opened_at || row.revoked_at) return null;
  const end = closesAt(row)!;
  if (end <= Date.now()) return null;
  return { id: row.id, label: row.label, openedAt: row.opened_at, closesAt: end };
}

/** Log one attempt, up to MAX_EVENTS_PER_CODE per code. */
export async function recordViewCodeEvent(env: Env, codeId: string, kind: ViewCodeEventKind): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO artifact_view_code_events (id, code_id, kind)
     SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM artifact_view_code_events WHERE code_id = ?) < ?`,
  ).bind(generateId('vce'), codeId, kind, codeId, MAX_EVENTS_PER_CODE).run();
}

/** Coarse device class for the owner's log — never the raw user agent. */
export function deviceClass(userAgent: string | null): 'phone' | 'tablet' | 'computer' {
  const ua = userAgent || '';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'phone';
  return 'computer';
}
