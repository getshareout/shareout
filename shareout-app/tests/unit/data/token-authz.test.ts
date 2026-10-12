// @vitest-environment node
/**
 * Data API auth for ShareOut API tokens on closed artifacts: a valid token alone must
 * not unlock another person's private data (E2E 2026-10-12 cross-tenant finding).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const tokenUser = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('../../../src/api-auth', async (orig) => ({
  ...(await orig<typeof import('../../../src/api-auth')>()),
  validateToken: vi.fn(async () => tokenUser.current),
}));

import { dataMiddleware } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';

const OWNER = 'usr_owner';
const OTHER = 'usr_other';
const WS = 'wsp_1';

function env(artifact: { visibility: string; workspace_id?: string | null }, opts: { member?: boolean; collaborator?: boolean } = {}) {
  const row = { id: 'art_1', name: 'x', visibility: artifact.visibility, auth_method: null, workspace_id: artifact.workspace_id ?? null, owner_id: OWNER, access_policy: null };
  return {
    SESSION_SECRET: 's',
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            if (sql.includes('FROM artifacts WHERE id')) return row;
            if (sql.includes('FROM collaborators')) return opts.collaborator ? { role: 'viewer' } : null;
            if (sql.includes("member_class = 'external'")) return null;
            if (sql.includes('workspace_members')) return opts.member ? { role: 'member', member_class: 'internal' } : null;
            return null;
          }),
          all: vi.fn(async () => ({ results: [] })),
        })),
      })),
    },
  } as unknown as Env;
}

const req = () => new Request('https://example.com/v1/data/art_1/json/k', { headers: { Authorization: 'Bearer so_x' } });

async function status(e: Env): Promise<number> {
  const r = await dataMiddleware(req(), e, 'art_1');
  return r instanceof Response ? r.status : 200;
}

describe('data API — personal token on closed artifacts', () => {
  beforeEach(() => { tokenUser.current = { id: OTHER, email: 'other@x.com' }; });

  it('denies a non-owner with no share on a private artifact (any workspace or Personal)', async () => {
    expect(await status(env({ visibility: 'private', workspace_id: WS }, { member: true }))).toBe(403);
    expect(await status(env({ visibility: 'private', workspace_id: null }))).toBe(403);
  });

  it('denies a non-member on a workspace-visible artifact', async () => {
    expect(await status(env({ visibility: 'workspace', workspace_id: WS }))).toBe(403);
  });

  it('allows the owner, a collaborator, and a member of a workspace-visible artifact', async () => {
    tokenUser.current = { id: OWNER, email: 'o@x.com' };
    expect(await status(env({ visibility: 'private', workspace_id: WS })), 'owner').toBe(200);
    tokenUser.current = { id: OTHER, email: 'other@x.com' };
    expect(await status(env({ visibility: 'private', workspace_id: WS }, { collaborator: true })), 'collaborator').toBe(200);
    expect(await status(env({ visibility: 'workspace', workspace_id: WS }, { member: true })), 'member').toBe(200);
  });

  it('confines workspace agent tokens: no private artifact they do not own', async () => {
    tokenUser.current = { id: 'usr_svc', email: null, service: { workspaceId: WS, scopes: ['data:read'] } };
    expect(await status(env({ visibility: 'private', workspace_id: WS }))).toBe(403);
    expect(await status(env({ visibility: 'workspace', workspace_id: WS }))).toBe(200);
  });
});
