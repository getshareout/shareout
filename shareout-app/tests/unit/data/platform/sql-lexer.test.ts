// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  countPlaceholders,
  hasMultipleStatements,
  lexSql,
  replacePlaceholders,
  withoutTrailingTerminator,
} from '../../../../src/data/platform/core/sql-lexer';
import { scopeSql } from '../../../../src/data/platform/core/viewer-scope';

const count = (sql: string) => countPlaceholders(lexSql(sql)!, 'viewer_scope');

describe('lexSql', () => {
  it('splits code, comments and quoted text', () => {
    expect(lexSql("SELECT 'a--b' -- c\n/* d */ FROM \"t\"")!.map((s) => s.kind)).toEqual([
      'code', 'quoted', 'code', 'comment', 'code', 'comment', 'code', 'quoted',
    ]);
  });

  it('handles doubled quotes, backslash escapes, backticks and dollar quotes', () => {
    expect(lexSql("SELECT 'it''s', 'a\\'b', `x`, $$ y $$, $t$ z $t$")).not.toBeNull();
    expect(count("SELECT 'it''s :viewer_scope'")).toBe(0);
    expect(count("SELECT 'a\\' :viewer_scope '")).toBe(0);
    expect(count('SELECT $$ :viewer_scope $$')).toBe(0);
    expect(count('SELECT $q$ :viewer_scope $q$')).toBe(0);
  });

  it('rejects unterminated and nested constructs', () => {
    for (const sql of ["SELECT 'x", 'SELECT "x', 'SELECT /* x', 'SELECT /* /* */ */ 1', 'SELECT $$ x', 'SELECT `x']) {
      expect(lexSql(sql), sql).toBeNull();
    }
  });

  it('keeps positional parameters as code', () => {
    expect(lexSql('SELECT $1, a$b')!.every((s) => s.kind === 'code')).toBe(true);
  });
});

describe('placeholders', () => {
  it('counts only placeholders in code', () => {
    expect(count('SELECT * FROM t WHERE c IN (:viewer_scope)')).toBe(1);
    expect(count('SELECT * FROM t -- :viewer_scope')).toBe(0);
    expect(count('SELECT * FROM t # :viewer_scope')).toBe(0);
    expect(count('SELECT * FROM t /* :viewer_scope */')).toBe(0);
    expect(count("SELECT ':viewer_scope' FROM t")).toBe(0);
    expect(count('SELECT ":viewer_scope" FROM t')).toBe(0);
  });

  it('ignores casts, path access and longer names', () => {
    expect(count('SELECT x::viewer_scope, v:viewer_scope, :viewer_scopes, :viewer_scope_x FROM t')).toBe(0);
  });

  it('replaces in code only', () => {
    const segs = lexSql("SELECT ':viewer_scope' WHERE a IN (:viewer_scope) -- :viewer_scope")!;
    expect(replacePlaceholders(segs, 'viewer_scope', '1, 2')).toBe("SELECT ':viewer_scope' WHERE a IN (1, 2) -- :viewer_scope");
  });
});

describe('statements', () => {
  it('allows one trailing terminator and comments after it', () => {
    expect(hasMultipleStatements(lexSql('SELECT 1;')!)).toBe(false);
    expect(hasMultipleStatements(lexSql('SELECT 1; -- done\n')!)).toBe(false);
    expect(hasMultipleStatements(lexSql("SELECT ';' FROM t")!)).toBe(false);
  });

  it('detects a second statement', () => {
    expect(hasMultipleStatements(lexSql('SELECT 1; SELECT 2')!)).toBe(true);
    expect(hasMultipleStatements(lexSql("SELECT 1; 'x'")!)).toBe(true);
    expect(hasMultipleStatements(lexSql('SELECT 1 /* a */; /* b */ DROP TABLE t')!)).toBe(true);
  });

  it('strips the trailing terminator', () => {
    expect(withoutTrailingTerminator(lexSql('SELECT 1 ; -- c')!)).toBe('SELECT 1 ');
    expect(withoutTrailingTerminator(lexSql("SELECT ';'")!)).toBe("SELECT ';'");
  });
});

describe('scopeSql', () => {
  it('substitutes a placeholder in code', () => {
    expect(scopeSql('SELECT * FROM t WHERE c IN (:viewer_scope)', 'c', [1, 'a'])).toEqual({
      ok: true, mode: 'placeholder', sql: "SELECT * FROM t WHERE c IN (1, 'a')",
    });
  });

  it('wraps SQL whose only placeholder is in a comment or literal', () => {
    for (const sql of ['SELECT * FROM t -- :viewer_scope', "SELECT ':viewer_scope' AS x, c FROM t"]) {
      const r = scopeSql(sql, 'c', [1]);
      expect(r.ok && r.mode).toBe('wrap');
      expect(r.ok && r.sql).toMatch(/\) AS so_scoped WHERE so_scoped\.c IN \(1\)$/);
    }
  });

  it('wraps with a newline so a trailing line comment cannot swallow the filter', () => {
    const r = scopeSql('SELECT * FROM t; -- note', 'c', []);
    expect(r).toEqual({ ok: true, mode: 'wrap', sql: 'SELECT * FROM (\nSELECT * FROM t\n) AS so_scoped WHERE so_scoped.c IN (NULL)' });
  });

  it('fails closed on multiple statements, bad lexing or an unsafe field', () => {
    expect(scopeSql('SELECT 1; SELECT 2', 'c', [1]).ok).toBe(false);
    expect(scopeSql("SELECT 'x", 'c', [1]).ok).toBe(false);
    expect(scopeSql('SELECT * FROM t', 'c-1', [1]).ok).toBe(false);
    expect(scopeSql('SELECT * FROM t WHERE x IN (:viewer_scope)', 'c-1', [1]).ok).toBe(true);
  });
});
