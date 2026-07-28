import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';
import type { ArtifactInfo } from '../../../src/serve/types';

vi.mock('../../../src/artifacts/access-requests', () => ({
  getPendingAccessRequest: vi.fn(async () => null),
}));

vi.mock('../../../src/auth', () => ({
  getSessionUser: vi.fn(async () => ({ id: 'usr_member', email: 'member@example.com' })),
  loginPage: () => new Response('login', { status: 401 }),
  accessDeniedPage: () => new Response('denied', { status: 403 }),
  passwordLoginPage: () => new Response('pw', { status: 401 }),
  credentialsLoginPage: () => new Response('cred', { status: 401 }),
  verifyAccessToken: vi.fn(async () => false),
}));

vi.mock('../../../src/account-links', () => ({
  getVisibilityScope: vi.fn(async () => ({ userIds: ['usr_member'], emails: [] })),
  placeholders: (n: number) => Array(n).fill('?').join(','),
}));

vi.mock('../../../src/serve/social-meta', () => ({
  resolveArtifactSocialPreview: () => ({}),
}));

import { checkAccess } from '../../../src/serve/access';

function makeArtifact(overrides: Partial<ArtifactInfo> = {}): ArtifactInfo {
  return {
    version_id: 'ver_1',
    entrypoint: 'index.html',
    mobile_entrypoint: null,
    artifact_id: 'art_1',
    artifact_name: 'Demo',
    description: null,
    social_title: null,
    social_description: null,
    social_image_url: null,
    thumbnail_ext: null,
    visibility: 'workspace',
    auth_method: 'google',
    owner_id: 'usr_owner',
    workspace_id: 'wsp_x',
    paused: 0,
    has_mobile: 0,
    pwa_config: null,
    artifact_type: 'app',
    type_metadata: null,
    access_policy: null,
    manifest_json: null,
    ...overrides,
  } as ArtifactInfo;
}

const baseEnv = { SHAREOUT_BASE_URL: 'https://shareout.example.com' } as unknown as Env;

function makeDb(preparedSql: string[], roleByUser: Record<string, string | null>) {
  return {
    prepare: vi.fn((sql: string) => {
      preparedSql.push(sql);
      return {
        bind: vi.fn((...args: unknown[]) => ({
          first: vi.fn(async () => {
            if (sql.includes('SELECT role FROM workspace_members')) {
              const role = roleByUser[args[1] as string] ?? null;
              return role ? { role } : null;
            }
            if (sql.includes('FROM collaborators')) return null;
            if (sql.includes('SELECT workspace_id FROM artifacts')) return { workspace_id: 'wsp_x' };
            return null;
          }),
          // External-sharing canAccess() runs after the workspace check; no grants
          // seeded → empty result → access stays denied.
          all: vi.fn(async () => ({ results: [] })),
        })),
      };
    }),
  } as unknown as Env['DB'];
}

describe('checkAccess workspace visibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grants a member access using the threaded workspace_id, without re-querying it', async () => {
    const prepared: string[] = [];
    const env = { ...baseEnv, DB: makeDb(prepared, { usr_member: 'member' }) };
    const result = await checkAccess(new Request('https://shareout.example.com/x'), env, 'x', makeArtifact());
    expect(result).toBeNull();
    expect(prepared.some((s) => s.includes('SELECT workspace_id FROM artifacts'))).toBe(false);
  });

  it('falls back to a workspace_id query for stale cache records missing the field', async () => {
    const prepared: string[] = [];
    const env = { ...baseEnv, DB: makeDb(prepared, { usr_member: 'member' }) };
    const stale = makeArtifact();
    delete (stale as { workspace_id?: string | null }).workspace_id;
    const result = await checkAccess(new Request('https://shareout.example.com/x'), env, 'x', stale);
    expect(result).toBeNull();
    expect(prepared.some((s) => s.includes('SELECT workspace_id FROM artifacts'))).toBe(true);
  });

  it('denies a non-member', async () => {
    const prepared: string[] = [];
    const env = { ...baseEnv, DB: makeDb(prepared, { usr_member: null }) };
    const result = await checkAccess(new Request('https://shareout.example.com/x'), env, 'x', makeArtifact());
    expect(result?.status).toBe(403);
  });
});
