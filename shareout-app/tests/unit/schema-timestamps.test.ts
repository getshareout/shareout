/**
 * The timestamp convention, enforced against the real schema.
 *
 * One type and one format is only true until someone adds a column. This reads
 * 0000_init.sql and fails on the two mistakes that are easy to make and expensive to
 * find: an epoch INTEGER (silently sorts and compares differently from every other
 * table) and a `datetime('now')` default (returns a space-separated string that
 * JavaScript parses as LOCAL time — correct on a UTC Worker, wrong everywhere else).
 *
 * See migrations/CONVENTIONS.md § "Timestamps: one type, one format, one vocabulary".
 */
import { describe, expect, it } from 'vitest';
// ?raw inlines the file at build time — the workers pool has no filesystem, and
// asserting against a copy would defeat the point.
import initSql from '../../migrations/0000_init.sql?raw';

const CANONICAL_DEFAULT = "DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

/**
 * Table bodies, found by scanning to the balanced closing paren rather than to a
 * `\n);` line. A table whose last column and closing paren share a line — the
 * ALTER-accreted ones — is invisible to the line-based version, and the non-greedy
 * match runs past it and swallows the tables that follow. That hid 15 tables from
 * these rules until PR-10.
 */
function tableBodies(sql: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /CREATE TABLE(?: IF NOT EXISTS)? ["`]?([a-z0-9_]+)["`]?\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
    }
    out.push({ name: m[1], body: sql.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}

/** Column lines inside CREATE TABLE bodies, as `<table>.<column> <TYPE> …`. */
function columnLines(): Array<{ table: string; column: string; type: string; line: string }> {
  const out: Array<{ table: string; column: string; type: string; line: string }> = [];
  for (const { name: table, body } of tableBodies(initSql)) {
    // Split on top-level commas, not newlines: columns added by ALTER land packed
    // onto one line, and a per-line regex only ever sees the first of them. Three
    // INTEGER `*_at` columns hid behind exactly that until PR-9.
    let depth = 0;
    let cur = '';
    const parts: string[] = [];
    for (const ch of body) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    for (const part of parts) {
      const decl = part.trim().split('--')[0].trim();
      const m = decl.match(/^["`]?([a-z0-9_]+)["`]?\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/i);
      if (m) out.push({ table, column: m[1], type: m[2].toUpperCase(), line: decl });
    }
  }
  return out;
}

const columns = columnLines();
const timestamps = columns.filter((c) => /(_at|_date)$/.test(c.column));
/** `*_at` is an instant; `*_date` is a calendar day and takes date('now'). */
const instants = timestamps.filter((c) => c.column.endsWith('_at'));
const dates = timestamps.filter((c) => c.column.endsWith('_date'));

describe('schema timestamp convention', () => {
  it('finds timestamp columns to check (guards against a broken parser)', () => {
    expect(columns.length).toBeGreaterThan(500);
    expect(timestamps.length).toBeGreaterThan(150);
  });

  it('stores every *_at / *_date column as TEXT', () => {
    const wrong = timestamps.filter((c) => c.type !== 'TEXT')
      .map((c) => `${c.table}.${c.column} is ${c.type}`);
    expect(wrong).toEqual([]);
  });

  it('uses the one canonical default for instants, never datetime()', () => {
    const wrong = instants
      .filter((c) => /\bDEFAULT\b/i.test(c.line) && !c.line.includes(CANONICAL_DEFAULT))
      .map((c) => `${c.table}.${c.column}: ${c.line}`);
    expect(wrong).toEqual([]);
  });

  it("defaults date-only columns with date('now')", () => {
    const wrong = dates
      .filter((c) => /\bDEFAULT\b/i.test(c.line) && !c.line.includes("DEFAULT (date('now'))"))
      .map((c) => `${c.table}.${c.column}: ${c.line}`);
    expect(wrong).toEqual([]);
  });

  it('has no epoch-integer timestamps anywhere in the file', () => {
    expect(initSql).not.toContain('unixepoch');
  });

  it('uses no banned timestamp names', () => {
    const banned = columns
      .filter((c) => /^(ts|timestamp)$/.test(c.column) || /_time$/.test(c.column))
      .map((c) => `${c.table}.${c.column}`);
    expect(banned).toEqual([]);
  });

  it('produces a value JavaScript round-trips exactly', () => {
    // What the canonical default emits, byte-for-byte. Round-tripping through Date is
    // the whole reason for the format: no helper, no parsing, no timezone assumption.
    const sample = '2026-07-26T14:54:55.401Z';
    expect(new Date(sample).toISOString()).toBe(sample);
    // The rejected alternative carries no zone designator at all, which is what lets a
    // non-UTC runtime read it as local time. (Asserting the actual shift would only
    // reproduce off-UTC, and CI runs UTC.)
    expect('2026-07-26 14:54:55').not.toMatch(/[TZ]/);
    expect(sample).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
