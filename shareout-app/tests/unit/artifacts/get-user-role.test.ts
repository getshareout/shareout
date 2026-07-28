// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { getUserRole } from '../../../src/artifacts';
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

describe('getUserRole', () => {
  it('returns owner when user owns the artifact', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
      }),
    };

    await expect(getUserRole(env, 'art_1', 'usr_1')).resolves.toBe('owner');
  });

  it('returns collaborator role when user is not the owner', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'editor@example.com' };
          if (sql.includes('role FROM collaborators')) return { role: 'editor' };
          return null;
        },
      }),
    };

    await expect(getUserRole(env, 'art_1', 'usr_2')).resolves.toBe('editor');
  });

  it('returns null when user has no access', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'stranger@example.com' };
          return null;
        },
      }),
    };

    await expect(getUserRole(env, 'art_1', 'usr_3')).resolves.toBeNull();
  });
});

