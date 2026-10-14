// @vitest-environment node
// vitest-isolate: fails when it shares an isolate with the other artifact suites.
// A plain workspace member reads details of, and comments on, a workspace-visible
// artifact (same closed-artifact viewer rule as the data API).
import './setup';
import { describe, expect, it } from 'vitest';
import { handleGetArtifact } from '../../../src/artifacts';
import { addArtifactComment, queryArtifactComments } from '../../../src/pages/home/queries/comments';
import { artifactRow, baseEnv, jsonBody, makeDbMock } from './shared';
import type { Env } from '../../../src/types';

const member = { id: 'usr_m', email: 'm@x.com', username: null };
const vis = { userIds: ['usr_m'], emails: ['m@x.com'] };

function env(visibility: string, opts: { member: boolean; wsRole?: string; ownerId?: string }): Env {
  const row = { ...artifactRow, owner_id: opts.ownerId ?? 'usr_owner', workspace_id: 'wsp_1', visibility };
  return {
    ...baseEnv,
    DB: makeDbMock({
      first: (sql, ...args) => {
        if (sql.includes('is_favorite')) return args.includes(row.id) || (sql.includes('a.slug = ?') && args.includes(row.slug)) ? row : null;
        if (sql.includes('owner_id FROM artifacts')) return row;
        if (sql.includes('email FROM users')) return { email: member.email };
        if (sql.includes('workspace_members')) return opts.member ? { role: opts.wsRole ?? 'member' } : null;
        return null;
      },
      all: (sql) => sql.includes('collaborators')
        ? { results: [{ email: 'v@x.com', role: 'viewer' }] }
        : { results: [] },
    }),
  } as unknown as Env;
}

describe('workspace member on a workspace-visible artifact', () => {
  it('GET details → 200 with the real visibility, without the collaborator list', async () => {
    const res = await handleGetArtifact(new Request('https://x'), env('workspace', { member: true }), member, 'art_1');
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({ visibility: 'workspace', viewers: [] });
  });

  it('GET details tells a plain member they cannot edit or trash', async () => {
    const res = await handleGetArtifact(new Request('https://x'), env('workspace', { member: true }), member, 'art_1');
    expect(await jsonBody(res)).toMatchObject({ can_edit: false, can_delete: false });
  });

  it('GET details lets a workspace admin trash but not edit, and the owner do both', async () => {
    const admin = await handleGetArtifact(new Request('https://x'), env('workspace', { member: true, wsRole: 'admin' }), member, 'art_1');
    expect(await jsonBody(admin)).toMatchObject({ can_edit: false, can_delete: true });
    const owner = await handleGetArtifact(new Request('https://x'), env('workspace', { member: true, ownerId: 'usr_m' }), member, 'art_1');
    expect(await jsonBody(owner)).toMatchObject({ can_edit: true, can_delete: true });
  });

  it('GET details resolves a slug (Home deep link #a/<slug>) to the artifact id', async () => {
    const res = await handleGetArtifact(new Request('https://x'), env('workspace', { member: true }), member, artifactRow.slug);
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({ id: 'art_1', slug: artifactRow.slug });
  });

  it('GET details → 403 for a non-member and for a member on a private artifact', async () => {
    expect((await handleGetArtifact(new Request('https://x'), env('workspace', { member: false }), member, 'art_1')).status).toBe(403);
    expect((await handleGetArtifact(new Request('https://x'), env('private', { member: true }), member, 'art_1')).status).toBe(403);
  });

  it('can post and list Inspector comments', async () => {
    const e = env('workspace', { member: true });
    const c = await addArtifactComment(e, member, 'art_1', 'hola', null, undefined, vis);
    expect(c?.content).toBe('hola');
    expect(await queryArtifactComments(e, member, 'art_1', 200, vis)).toEqual([]);
  });

  it('cannot comment when not a member', async () => {
    expect(await addArtifactComment(env('workspace', { member: false }), member, 'art_1', 'hola', null, undefined, vis)).toBeNull();
  });
});
