// The only SQL a metric author writes is a base SELECT (`source.sql`) and fixed filters.
// Both are spliced into the compiled query, so beyond the read-only guard they must
// not be able to close a parenthesis we opened, comment out what follows them, or chain
// a statement. Values from a query caller never take this path: they become literals.
//
// The checks lean on lexSql, which reads a backslash inside quotes as an escape. SQLite
// and standard Postgres strings do not, so a backslash is where the lexer and the
// database could disagree about what is code; wherever that could matter it is refused.
import { validateReadOnlySql } from '../../data/connections/sql-guard';
import { hasMultipleStatements, lexSql, type SqlSegment } from '../../data/platform/core/sql-lexer';

export type Dialect = 'bigquery' | 'snowflake' | 'postgres' | 'sqlite';

/** Dialects whose plain strings take a backslash literally (lexSql would not). */
const LITERAL_BACKSLASH: ReadonlySet<Dialect> = new Set(['postgres', 'sqlite']);

function balanced(segments: SqlSegment[]): boolean {
  let depth = 0;
  for (const s of segments) {
    if (s.kind !== 'code') continue;
    for (const ch of s.text) {
      if (ch === '(') depth++;
      else if (ch === ')' && --depth < 0) return false;
    }
  }
  return depth === 0;
}

const codeOf = (segments: SqlSegment[]) => segments.filter(s => s.kind === 'code').map(s => s.text).join(' ');

// For SQL we generated, the keyword guard should read the statement's shape: quoted
// text blanked (a value like 'Set B' is not a SET), comments dropped.
const codeShape = (segments: SqlSegment[]) =>
  segments.map(s => (s.kind === 'quoted' ? "''" : s.kind === 'comment' ? ' ' : s.text)).join('');

/** Why compiled SQL is not one read-only statement, or null. */
export function compiledSqlProblem(sql: string): string | null {
  const segments = lexSql(sql);
  if (!segments) return 'it has an unterminated quote or comment';
  if (hasMultipleStatements(segments)) return 'it must be a single statement';
  const guard = validateReadOnlySql(codeShape(segments));
  return guard.ok ? null : guard.reason ?? 'it is not read-only';
}

/**
 * A base SELECT with comments and trailing `;` removed, or why it cannot be used. The
 * read-only guard reads the raw text, quotes and all — stricter than it needs to be,
 * never looser. `dialect` is known once the connection is: on Postgres a backslash is
 * refused (see above).
 */
export function cleanBaseSql(sql: string, dialect: Dialect | null = null): { ok: true; sql: string } | { ok: false; reason: string } {
  const segments = lexSql(sql);
  if (!segments) return { ok: false, reason: 'source.sql has an unterminated quote or comment' };
  if (hasMultipleStatements(segments)) return { ok: false, reason: 'source.sql must be a single SELECT statement' };
  const guard = validateReadOnlySql(sql);
  if (!guard.ok) return { ok: false, reason: `source.sql: ${guard.reason}` };
  if (dialect && LITERAL_BACKSLASH.has(dialect) && sql.includes('\\')) {
    return { ok: false, reason: 'source.sql cannot contain a backslash on this database' };
  }
  const code = segments.map(s => (s.kind === 'comment' ? { kind: 'code' as const, text: ' ' } : s));
  if (!balanced(code)) return { ok: false, reason: 'source.sql has unbalanced parentheses' };
  let cleaned = code.map(s => s.text).join('').trim();
  while (/;\s*$/.test(cleaned)) cleaned = cleaned.replace(/;\s*$/, '').trim();
  return { ok: true, sql: cleaned };
}

/**
 * Why a fixed filter cannot be used, or null. A filter is one boolean condition over
 * the source's columns: no comments, no `;`, no backslash, balanced parentheses,
 * read-only. On a shared table it may not read any other table (the artifact's store
 * holds more than the table that was shared) and may not use `$`.
 */
export function filterProblem(filter: string, dialect: Dialect | null): string | null {
  if (filter.includes('\\')) return 'a filter cannot contain a backslash';
  const segments = lexSql(filter);
  if (!segments) return 'it has an unterminated quote or comment';
  if (segments.some(s => s.kind === 'comment')) return 'comments are not allowed in a filter';
  const code = codeOf(segments);
  if (code.includes(';')) return 'a filter is a single condition, without ";"';
  if (!balanced(segments)) return 'it has unbalanced parentheses';
  const guard = validateReadOnlySql(`SELECT 1 FROM so_base WHERE ${filter}`);
  if (!guard.ok) return guard.reason ?? 'it is not read-only';
  if (dialect === 'sqlite') {
    if (/\b(select|from|with|union|join)\b/i.test(code)) return 'a filter on a shared table can only compare the table’s own columns';
    if (filter.includes('$')) return 'a filter on a shared table cannot contain "$"';
  }
  return null;
}

const SQL_WORDS = new Set([
  'and', 'or', 'not', 'in', 'is', 'null', 'like', 'glob', 'between', 'true', 'false', 'case', 'when',
  'then', 'else', 'end', 'cast', 'as', 'escape', 'collate', 'nocase', 'distinct', 'exists', 'integer',
  'real', 'text', 'numeric', 'blob', 'current_date', 'current_time', 'current_timestamp', 'asc', 'desc',
]);

/** Column names a shared-table filter refers to, so the base can project them. */
export function filterColumns(filter: string): string[] {
  const out = new Set<string>();
  for (const s of lexSql(filter) ?? []) {
    if (s.kind === 'quoted' && (s.text[0] === '"' || s.text[0] === '`')) {
      out.add(s.text.slice(1, -1).replace(s.text[0] === '"' ? /""/g : /``/g, s.text[0]));
      continue;
    }
    if (s.kind !== 'code') continue;
    for (const m of s.text.matchAll(/[\p{L}_][\p{L}\p{N}_]*/gu)) {
      const before = s.text[m.index - 1] ?? '';
      if (/[\p{N}.]/u.test(before)) continue;
      if (/^\s*\(/.test(s.text.slice(m.index + m[0].length))) continue;
      if (!SQL_WORDS.has(m[0].toLowerCase())) out.add(m[0]);
    }
  }
  return [...out];
}

/**
 * A value as a SQL literal in `dialect`, or null when it cannot be one safely. Control
 * characters are refused everywhere; each dialect escapes quotes, and backslashes where
 * they are escape characters. Where they are not (Postgres family, SQLite), a value
 * with a backslash is refused instead of guessed at.
 */
export function sqlLiteral(dialect: Dialect, value: string | number): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  switch (dialect) {
    case 'bigquery':
      return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    case 'snowflake':
      return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    case 'postgres':
    case 'sqlite':
      return value.includes('\\') ? null : `'${value.replace(/'/g, "''")}'`;
  }
}
