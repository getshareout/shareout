import { describe, expect, it } from 'vitest';
import { validateReadOnlySql } from '../../../src/data/connections/sql-guard';

describe('validateReadOnlySql', () => {
  const allowed = [
    'SELECT 1',
    'select * from orders where region = :viewer_scope',
    'WITH t AS (SELECT 1 AS n) SELECT n FROM t',
    '  SELECT count(*) FROM events ;',
    'select a from b -- trailing comment',
  ];
  for (const sql of allowed) {
    it(`allows: ${sql}`, () => {
      expect(validateReadOnlySql(sql).ok).toBe(true);
    });
  }

  const denied = [
    'INSERT INTO t VALUES (1)',
    'UPDATE t SET x = 1',
    'DELETE FROM t',
    'DROP TABLE t',
    'SELECT 1; DROP TABLE t',
    'SELECT * INTO new_t FROM t',
    'TRUNCATE t',
    'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = 1',
    'CREATE TABLE t (id int)',
    'GRANT SELECT ON t TO u',
    '/* SELECT */ DELETE FROM t',
    '',
    '   ',
  ];
  for (const sql of denied) {
    it(`denies: ${JSON.stringify(sql)}`, () => {
      expect(validateReadOnlySql(sql).ok).toBe(false);
    });
  }

  it('strips a single trailing semicolon from the cleaned sql', () => {
    const r = validateReadOnlySql('SELECT 1 ;');
    expect(r.ok).toBe(true);
    expect(r.sql).toBe('SELECT 1');
  });
});
