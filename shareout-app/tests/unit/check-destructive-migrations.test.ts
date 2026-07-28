/**
 * The deploy guard's detection logic. If this regresses, a migration that drops a
 * table reaches a live instance the next time anyone runs `npm run deploy`.
 *
 * The script itself shells out to wrangler, so what is worth pinning here is the part
 * that decides *what counts as destructive*: the regexes and the comment stripping.
 * Those are duplicated from scripts/check-destructive-migrations.mjs deliberately —
 * the script has no exports because it runs as a CLI, and a bad copy here fails loudly
 * against the real schema file below.
 */
import { describe, expect, it } from 'vitest';
// ?raw inlines the real file at build time — the workers test pool has no filesystem,
// and asserting against a copy of the SQL would defeat the point of the last case.
import initSql from '../../migrations/0000_init.sql?raw';

const DESTRUCTIVE: Array<[RegExp, string]> = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
  [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
  [/\bUPDATE\s+\w+\s+SET\b/i, 'UPDATE … SET'],
];

const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const scan = (sql: string) =>
  DESTRUCTIVE.filter(([re]) => re.test(stripComments(sql))).map(([, label]) => label);

describe('destructive migration detection', () => {
  it('flags each destructive statement kind', () => {
    expect(scan('DROP TABLE foo;')).toContain('DROP TABLE');
    expect(scan('ALTER TABLE foo DROP COLUMN bar;')).toContain('DROP COLUMN');
    expect(scan('DELETE FROM foo WHERE x = 1;')).toContain('DELETE FROM');
    expect(scan('UPDATE foo SET bar = 1;')).toContain('UPDATE … SET');
  });

  it('ignores destructive words inside comments', () => {
    expect(scan('-- this migration does not DROP TABLE anything\nCREATE TABLE a (id TEXT);')).toEqual([]);
    expect(scan('/* DELETE FROM in a block comment */\nCREATE TABLE b (id TEXT);')).toEqual([]);
  });

  it('does not flag structure-only drops', () => {
    // Recreating an index or trigger costs nothing; losing rows does not.
    expect(scan('DROP INDEX IF EXISTS idx_foo;')).toEqual([]);
    expect(scan('DROP TRIGGER IF EXISTS validate_foo;')).toEqual([]);
  });

  it('does not flag ordinary DDL', () => {
    expect(scan('CREATE TABLE IF NOT EXISTS foo (id TEXT PRIMARY KEY);')).toEqual([]);
    expect(scan('ALTER TABLE foo ADD COLUMN bar TEXT;')).toEqual([]);
    expect(scan("INSERT OR IGNORE INTO foo (id) VALUES ('a');")).toEqual([]);
  });

  it('clears 0000_init.sql, which only creates', () => {
    // The whole schema in one file, and not one destructive statement in it. If this
    // ever fails, someone put a DROP or a DELETE into the file that self-hosters run
    // against an empty database.
    expect(scan(initSql)).toEqual([]);
  });
});
