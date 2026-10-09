import { afterEach, describe, expect, it, vi } from 'vitest';

const roleMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole: roleMock }));

import { inviteMembersTool, listMembersTool } from '../../../src/chat-agent/tools/members';
import { describeActionRich, type PendingAction } from '../../../src/chat-agent/actions';
import type { Env } from '../../../src/types';

function env(rows: unknown[] = []): Env {
  return {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ name: 'Team' })),
          all: vi.fn(async () => ({ results: rows })),
        })),
      })),
    },
  } as unknown as Env;
}

afterEach(() => vi.clearAllMocks());

describe('invite_members tool', () => {
  it('needs a workspace selected', async () => {
    const out = await inviteMembersTool.execute({ env: env(), userId: 'u1', selectedWorkspaceId: null }, { emails: ['a@x.com'] });
    expect(out).toHaveProperty('error');
  });

  it('refuses non-admins', async () => {
    roleMock.mockResolvedValue('member');
    const out = await inviteMembersTool.execute({ env: env(), userId: 'u1', selectedWorkspaceId: 'wsp_1' }, { emails: ['a@x.com'] });
    expect(out).toEqual({ error: expect.stringContaining('admins') });
  });

  it('proposes (does not send) a parsed, deduped list for the admin to confirm', async () => {
    roleMock.mockResolvedValue('admin');
    const out = await inviteMembersTool.execute(
      { env: env(), userId: 'u1', selectedWorkspaceId: 'wsp_1' },
      { emails: ['Ana <ana@x.com>, bob@x.com', 'ANA@x.com', 'bad@'], role: 'admin', message: ' hola ' },
    ) as { __propose: PendingAction };
    expect(out.__propose).toEqual({
      kind: 'invite_members', workspaceId: 'wsp_1', workspaceName: 'Team',
      emails: ['ana@x.com', 'bob@x.com'], role: 'admin', message: 'hola', invalid: ['bad@'],
    });
    const card = describeActionRich(out.__propose);
    expect(card.title).toBe('Invite 2 people');
    expect(card.lines).toEqual(['ana@x.com', 'bob@x.com']);
  });
});

describe('list_members tool', () => {
  it('lists members for admins', async () => {
    roleMock.mockResolvedValue('owner');
    const out = await listMembersTool.execute(
      { env: env([{ email: 'a@x.com', name: 'A', role: 'owner', pending: 0 }]), userId: 'u1', selectedWorkspaceId: 'wsp_1' }, {},
    );
    expect(out).toEqual({ members: [{ email: 'a@x.com', name: 'A', role: 'owner', pending: false }] });
  });
});
