// Minimal comment- and literal-aware SQL lexer. It does not parse SQL; it only splits
// text into code / comment / quoted segments so callers can find placeholders and
// statement separators in code and nowhere else.
//
// It is deliberately conservative across dialects (Snowflake, BigQuery, Postgres,
// Redshift, MySQL): `#` starts a line comment, backslash escapes inside quotes, and a
// nested `/*` is rejected. When a dialect reads the text differently, the effect is that
// a placeholder is NOT substituted (the query then fails), never that one is
// substituted inside text the database ignores.

export type SqlSegmentKind = 'code' | 'comment' | 'quoted';

export interface SqlSegment {
  kind: SqlSegmentKind;
  text: string;
}

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/** Split SQL into segments. Returns null for unterminated or nested constructs. */
export function lexSql(sql: string): SqlSegment[] | null {
  const out: SqlSegment[] = [];
  let code = '';
  let i = 0;
  const flush = () => {
    if (code) out.push({ kind: 'code', text: code });
    code = '';
  };

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if ((c === '-' && next === '-') || c === '#') {
      flush();
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out.push({ kind: 'comment', text: sql.slice(i, stop) });
      i = stop;
      continue;
    }

    if (c === '/' && next === '*') {
      flush();
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return null;
      const body = sql.slice(i + 2, end);
      if (body.includes('/*')) return null;
      out.push({ kind: 'comment', text: sql.slice(i, end + 2) });
      i = end + 2;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      flush();
      let j = i + 1;
      let closed = false;
      while (j < sql.length) {
        const d = sql[j];
        if (d === '\\') { j += 2; continue; }
        if (d === c) {
          if (sql[j + 1] === c) { j += 2; continue; }
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) return null;
      out.push({ kind: 'quoted', text: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    if (c === '$' && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {
      const m = DOLLAR_TAG.exec(sql.slice(i));
      if (m) {
        flush();
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) return null;
        out.push({ kind: 'quoted', text: sql.slice(i, end + tag.length) });
        i = end + tag.length;
        continue;
      }
    }

    code += c;
    i++;
  }
  flush();
  return out;
}

/** True when a `;` in code is followed by more code (comments and whitespace aside). */
export function hasMultipleStatements(segments: SqlSegment[]): boolean {
  let sawTerminator = false;
  for (const s of segments) {
    if (s.kind === 'comment') continue;
    if (s.kind === 'quoted') {
      if (sawTerminator) return true;
      continue;
    }
    for (const ch of s.text) {
      if (sawTerminator && !/\s|;/.test(ch)) return true;
      if (ch === ';') sawTerminator = true;
    }
  }
  return false;
}

/** The SQL with one trailing `;` (and anything after it but whitespace/comments) removed. */
export function withoutTrailingTerminator(segments: SqlSegment[]): string {
  let idx = -1;
  for (let k = segments.length - 1; k >= 0; k--) {
    const s = segments[k];
    if (s.kind === 'comment' || (s.kind === 'code' && !s.text.trim())) continue;
    if (s.kind === 'code' && /;\s*$/.test(s.text)) idx = k;
    break;
  }
  if (idx === -1) return segments.map((s) => s.text).join('');
  const head = segments.slice(0, idx).map((s) => s.text).join('');
  return head + segments[idx].text.replace(/;\s*$/, '');
}

function placeholderPattern(name: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_:$.]):${name}(?![A-Za-z0-9_$])`, 'g');
}

/** Count `:name` placeholders that appear in code (not in comments or quoted text). */
export function countPlaceholders(segments: SqlSegment[], name: string): number {
  let n = 0;
  for (const s of segments) {
    if (s.kind === 'code') n += s.text.match(placeholderPattern(name))?.length ?? 0;
  }
  return n;
}

/** Replace `:name` placeholders in code segments only. */
export function replacePlaceholders(segments: SqlSegment[], name: string, replacement: string): string {
  return segments
    .map((s) => (s.kind === 'code' ? s.text.replace(placeholderPattern(name), () => replacement) : s.text))
    .join('');
}
