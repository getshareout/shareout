// @vitest-environment node
/**
 * Structural guard for the tables handler test decomposition (2026-07-21).
 * Ensures the monolithic tables.test.ts stays split into focused modules.
 */
import { describe, expect, it } from 'vitest';

const tablesTests = import.meta.glob('./tables/*.test.ts');
const tablesSupport = import.meta.glob('./tables/{shared,setup,mocks,index}.ts', { eager: true });

const EXPECTED_SUITES = [
  'auth.test.ts',
  'csv-export.test.ts',
  'handler-validation.test.ts',
  'list-schema.test.ts',
  'method-guards.test.ts',
  'name-id-join.test.ts',
  'query-actions.test.ts',
  'query-count-opt-out.test.ts',
  'row-crud.test.ts',
  'row-limits.test.ts',
  // filter-sql and write-policy are pure unit tests for table SQL helpers
  'filter-sql.test.ts',
  'write-policy.test.ts',
].sort();

describe('tables test module layout', () => {
  it('loads focused test modules (no monolithic tables.test.ts)', () => {
    const names = Object.keys(tablesTests).map((p) => p.split('/').pop()!).sort();
    expect(names).toEqual(EXPECTED_SUITES);
    expect(names).not.toContain('tables.test.ts');
  });

  it('includes shared setup and barrel modules', () => {
    expect(Object.keys(tablesSupport)).toEqual(
      expect.arrayContaining([
        './tables/shared.ts',
        './tables/setup.ts',
        './tables/mocks.ts',
        './tables/index.ts',
      ]),
    );
  });

  it('exports shared fixtures from shared.ts', async () => {
    const shared = await import('./tables/shared');
    expect(shared.ARTIFACT_ID).toBe('art_1');
    expect(typeof shared.createTablesDb).toBe('function');
    expect(typeof shared.ctxFromDb).toBe('function');
    expect(typeof shared.tablesRequest).toBe('function');
  });
});
