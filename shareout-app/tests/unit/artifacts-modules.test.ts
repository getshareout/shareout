// @vitest-environment node
/**
 * Structural guard for the artifacts test decomposition (2026-07-10).
 * Ensures the monolithic artifacts.test.ts stays split into focused modules.
 */
import { describe, expect, it } from 'vitest';

const artifactTests = import.meta.glob('./artifacts/*.test.ts');
const artifactSupport = import.meta.glob('./artifacts/{shared,setup,index}.ts', { eager: true });

const EXPECTED_SUITES = [
  'add-collaborators.test.ts',
  'delete-artifact.test.ts',
  'export.test.ts',
  'get-artifact-files.test.ts',
  'get-artifact.test.ts',
  'get-collaborators.test.ts',
  'get-user-role.test.ts',
  'get-versions.test.ts',
  'list-artifacts.test.ts',
  'purge-soft-deleted.test.ts',
  'remove-collaborator.test.ts',
  'restore-artifact.test.ts',
  'rollback.test.ts',
  'roles.test.ts',
  'satellites.test.ts',
  'share.test.ts',
  'sharing-admin.test.ts',
  'tags.test.ts',
  'transfer-ownership.test.ts',
  'update-artifact.test.ts',
].sort();

describe('artifacts test module layout', () => {
  it('loads 20 focused test modules (no monolithic artifacts.test.ts)', () => {
    const names = Object.keys(artifactTests).map((p) => p.split('/').pop()!).sort();
    expect(names).toEqual(EXPECTED_SUITES);
    expect(names).not.toContain('artifacts.test.ts');
  });

  it('includes shared setup and barrel modules', () => {
    expect(Object.keys(artifactSupport)).toEqual(
      expect.arrayContaining(['./artifacts/shared.ts', './artifacts/setup.ts', './artifacts/index.ts']),
    );
  });

  it('exports shared fixtures from shared.ts', async () => {
    const shared = await import('./artifacts/shared');
    expect(shared.user.email).toBe('owner@example.com');
    expect(typeof shared.makeDbMock).toBe('function');
    expect(shared.artifactRow.id).toBe('art_1');
  });
});
