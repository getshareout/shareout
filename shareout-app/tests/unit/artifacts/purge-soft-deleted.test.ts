// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { purgeSoftDeleted } from '../../../src/artifacts';
import {
  artifactRow,
  baseEnv,
  jsonBody,
  makeDbMock,
  makeR2Mock,
  makeSlugsMock,
  ownerRoleFirst,
  user,
} from './shared';

describe('purgeSoftDeleted', () => {
  it('hard-purges only artifacts past the retention window', async () => {
    const deleteCalls: string[] = [];
    const env = {
      ...baseEnv,
      SLUGS: makeSlugsMock(),
      ARTIFACTS: makeR2Mock(),
      DB: makeDbMock({
        first: () => null,
        all: (sql) => {
          if (sql.includes('deleted_at IS NOT NULL AND deleted_at <')) {
            return { results: [{ id: 'art_old', slug: 'old-slug' }] };
          }
          return { results: [] };
        },
        run: (sql) => { deleteCalls.push(sql); return { success: true }; },
      }),
    };

    const purged = await purgeSoftDeleted(env);

    expect(purged).toBe(1);
    // The real purge ran for the expired artifact.
    expect(deleteCalls.some((s) => s.includes('DELETE FROM artifacts WHERE id = ?'))).toBe(true);
  });
});

