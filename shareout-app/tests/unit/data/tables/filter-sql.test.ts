// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filterToSql } from '../../../../src/data/tables/filter-sql';
import { buildScopeClause } from '../../../../src/data/tables/scope';
import { escapeField, validateTableName } from '../../../../src/data/tables/validation';

describe('tables/validation', () => {
  describe('validateTableName', () => {
    it('accepts valid names', () => {
      expect(validateTableName('users')).toBeNull();
      expect(validateTableName('line_items_v2')).toBeNull();
    });

    it('rejects empty and invalid names', () => {
      expect(validateTableName('')).toBeTruthy();
      expect(validateTableName('2bad')).toBeTruthy();
      expect(validateTableName('has-dash')).toBeTruthy();
    });
  });

  describe('escapeField', () => {
    it('escapes quotes and backslashes', () => {
      expect(escapeField("a'b")).toBe("a''b");
      expect(escapeField('a\\b')).toBe('a\\\\b');
    });
  });
});

describe('tables/filter-sql', () => {
  it('returns 1=1 for empty filter', () => {
    expect(filterToSql({})).toEqual({ sql: '1=1', params: [] });
  });

  it('compiles equality shorthand', () => {
    const { sql, params } = filterToSql({ status: 'open' });
    expect(sql).toContain('json_extract');
    expect(sql).toContain('= ?');
    expect(params).toEqual(['open']);
  });

  it('compiles operator objects', () => {
    const { sql, params } = filterToSql({ score: { $gte: 10, $lt: 100 } });
    expect(sql).toContain('>= ?');
    expect(sql).toContain('< ?');
    expect(params).toEqual([10, 100]);
  });

  it('compiles $in and string matchers', () => {
    const { sql, params } = filterToSql({
      tag: { $in: ['a', 'b'] },
      name: { $contains: 'foo' },
    });
    expect(sql).toContain('IN (?, ?)');
    expect(sql).toContain('LIKE ?');
    expect(params).toEqual(['a', 'b', '%foo%']);
  });

  it('handles null field values', () => {
    const { sql, params } = filterToSql({ deletedAt: null });
    expect(sql).toContain('IS NULL');
    expect(params).toEqual([]);
  });
});

describe('tables/scope', () => {
  it('allows all rows when scope is unset', () => {
    expect(buildScopeClause(null)).toEqual({ sql: '1=1', params: [] });
    expect(buildScopeClause(undefined)).toEqual({ sql: '1=1', params: [] });
  });

  it('denies all rows when scope values are empty', () => {
    expect(buildScopeClause({ field: 'ownerId', values: [] })).toEqual({ sql: '1=0', params: [] });
  });

  it('builds IN clause for scoped viewers', () => {
    const clause = buildScopeClause({ field: 'ownerId', values: ['u1', 'u2'] });
    expect(clause.sql).toContain('json_extract');
    expect(clause.sql).toContain('IN (?, ?)');
    expect(clause.params).toEqual(['u1', 'u2']);
  });
});
