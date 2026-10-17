/**
 * Content checks run on everything a template will carry. Secrets are redacted outright
 * (a template must never hold a credential). Everything else that looks
 * workspace-specific — emails, phone numbers, the workspace's own name, its members,
 * internal ids — is reported as a Finding the author reviews before saving.
 * Heuristics, not a guarantee: the checklist says so.
 */
import type { Finding, FindingKind } from './types';

export const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: RegExp[] = [
  /\bsot?_[A-Za-z0-9_-]{16,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}/g,
];

/** Replace anything that looks like a credential. */
export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, scheme?: string) => {
      count++;
      return typeof scheme === 'string' && /^(Bearer|Basic)$/.test(scheme) ? `${scheme} ${REDACTED}` : REDACTED;
    });
  }
  return { text: out, count };
}

export interface ScanContext {
  /** The source workspace's name and slug. */
  workspaceNames: string[];
  /** Member display names and emails of the source workspace. */
  memberNames: string[];
  memberEmails: string[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[.-])\d{3,4}[.-]\d{3,4}\b|\+\d{1,3} \d{2,4} \d{3,4} \d{3,4}\b/g;
const ID_RE = /\b(?:usr|wsp|art|fld|tok|con|dst|ver|shr)_[a-f0-9]{12,}\b/g;
const SAFE_EMAIL_DOMAINS = /@(example\.(com|org|net)|test|localhost)$/i;
const ASSET_EMAIL = /@\d+x\.(png|jpe?g|webp|gif|svg)$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** a***@e***.com — enough for the author to recognize, not enough to leak further. */
export function maskEmail(email: string): string {
  const [local, domain = ''] = email.split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
}

function maskPhone(p: string): string {
  const digits = p.replace(/\D/g, '');
  return `***${digits.slice(-2)}`;
}

export function scanText(text: string, ctx: ScanContext, item: string | null, where: string): Finding[] {
  const out = new Map<string, Finding>();
  const add = (kind: FindingKind, sample: string) => {
    const key = `${kind}:${sample}`;
    const f = out.get(key);
    if (f) f.count++;
    else out.set(key, { kind, item, where, sample, count: 1 });
  };

  const memberEmails = new Set(ctx.memberEmails.map((e) => e.toLowerCase()));
  for (const m of text.match(EMAIL_RE) ?? []) {
    if (SAFE_EMAIL_DOMAINS.test(m) || ASSET_EMAIL.test(m)) continue;
    add(memberEmails.has(m.toLowerCase()) ? 'member' : 'email', maskEmail(m));
  }
  for (const m of text.match(PHONE_RE) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) continue;
    add('phone', maskPhone(m));
  }
  for (const name of ctx.workspaceNames) {
    if (name.trim().length < 3) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    const n = [...text.matchAll(re)].length;
    for (let i = 0; i < n; i++) add('workspace_name', name.trim());
  }
  for (const name of ctx.memberNames) {
    const clean = name.trim();
    if (clean.length < 4 || !/\s/.test(clean)) continue;
    const re = new RegExp(`(^|[^\\p{L}])${escapeRe(clean)}(?=$|[^\\p{L}])`, 'giu');
    if (re.test(text)) add('member', clean.replace(/(\S)\S*/g, '$1.').replace(/\.\s/g, '. '));
  }
  for (const m of text.match(ID_RE) ?? []) add('internal_id', `${m.slice(0, 8)}…`);
  return [...out.values()];
}

/** Values of sample rows, flattened to text, go through the same scan. */
export function scanRows(rows: Record<string, unknown>[], ctx: ScanContext, item: string, where: string): Finding[] {
  if (!rows.length) return [];
  return scanText(rows.map((r) => Object.values(r).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))).join(' ')).join('\n'), ctx, item, where);
}

/** Merge findings from many places, keeping one line per kind+sample+item. */
export function mergeFindings(list: Finding[]): Finding[] {
  const out = new Map<string, Finding>();
  for (const f of list) {
    const key = `${f.kind}:${f.sample}:${f.item ?? ''}`;
    const prev = out.get(key);
    if (prev) prev.count += f.count;
    else out.set(key, { ...f });
  }
  return [...out.values()];
}
