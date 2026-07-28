/**
 * The schema guard's rules, pinned against the real schema.
 *
 * `scripts/check-migrations.mjs` runs as a CLI with no exports, and the workers test
 * pool has no filesystem — so the rules are restated here and run against the actual
 * `0000_init.sql` (inlined with `?raw`). A copy that drifts from the script fails
 * loudly on the real file, which is the point: these are the rules the schema is
 * *claimed* to follow, and this is the claim being checked.
 *
 * The script exempted 0000_init.sql for the whole v2 redesign. The exemption came off
 * with the last phase; this test is why it can stay off.
 */
import { describe, expect, it } from 'vitest';
import initSql from '../../migrations/0000_init.sql?raw';
import schemaDoc from '../../migrations/SCHEMA.md?raw';

const stripped = initSql.replace(/--[^\n]*/g, '');

/** Column declarations, split on top-level commas — ALTER-added columns share a line. */
function splitColumns(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

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

const tables = tableBodies(stripped);

describe('schema guard rules, against the real schema', () => {
  it('parses every table (a broken parser would pass everything below)', () => {
    expect(tables.length).toBeGreaterThan(130);
    expect(tables.map((t) => t.name)).toContain('artifacts');
  });

  it('names every table and column in lower_snake_case, unquoted', () => {
    const bad: string[] = [];
    for (const { name, body } of tables) {
      if (!/^[a-z][a-z0-9_]*$/.test(name)) bad.push(`table ${name}`);
      for (const decl of splitColumns(body)) {
        const m = decl.match(/^["`]?([a-z0-9_]+)["`]?\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/i);
        if (m && !/^[a-z][a-z0-9_]*$/.test(m[1])) bad.push(`${name}.${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
    expect(stripped).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "/);
  });

  it('records a moment on every table — created_at, or the domain word for it', () => {
    const RECORDS_A_MOMENT = /\b([a-z0-9_]*_at|[a-z0-9_]*_date|date|period|hour|window_start)\b/;
    const timeless = tables.filter((t) => !RECORDS_A_MOMENT.test(t.body)).map((t) => t.name);
    expect(timeless).toEqual([]);
  });

  it('types timestamps TEXT and booleans INTEGER', () => {
    const bad: string[] = [];
    for (const { name, body } of tables) {
      for (const decl of splitColumns(body)) {
        const m = decl.match(/^["`]?([a-z0-9_]+)["`]?\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/i);
        if (!m) continue;
        const [, col, type] = [m[0], m[1], m[2].toUpperCase()];
        if (/(_at|_date)$/.test(col) && type !== 'TEXT') bad.push(`${name}.${col} is ${type}`);
        if (/^(is_|has_)/.test(col) && type !== 'INTEGER') bad.push(`${name}.${col} is ${type}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('documents every table in SCHEMA.md', () => {
    const undocumented = tables.filter((t) => !schemaDoc.includes(`\`${t.name}\``)).map((t) => t.name);
    expect(undocumented).toEqual([]);
  });

  it('declares a foreign key on every ownership column', () => {
    // The four columns the redesign closed to 100%. A new table that names one of them
    // and does not reference its parent is the regression this catches.
    const OWNERSHIP = ['artifact_id', 'workspace_id', 'user_id', 'owner_id'];
    const bad: string[] = [];
    for (const { name, body } of tables) {
      const declaresFk = (col: string) =>
        new RegExp(`\\b${col}\\b[^,]*REFERENCES`, 'i').test(body) ||
        new RegExp(`FOREIGN KEY\\s*\\(\\s*${col}\\s*\\)`, 'i').test(body);
      for (const decl of splitColumns(body)) {
        const m = decl.match(/^["`]?([a-z0-9_]+)["`]?\s+TEXT\b/i);
        if (m && OWNERSHIP.includes(m[1]) && !declaresFk(m[1])) bad.push(`${name}.${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
