import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/email/gateway', () => ({ dispatchLifecycleEmail: dispatchMock }));

import { sendInviteEmail } from '../../../src/workspaces-invite-email';
import type { Env } from '../../../src/types';

/** Capture every UPDATE the send path writes, with its bound values. */
function dbMock(writes: Array<{ sql: string; args: unknown[] }>, opts: { throwOnRun?: boolean } = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        run: vi.fn(async () => {
          if (opts.throwOnRun) throw new Error('D1 down');
          writes.push({ sql, args });
          return { success: true };
        }),
      })),
    })),
  } as unknown as Env['DB'];
}

const args = { email: 'max@example.com', workspaceName: 'Acme', inviterName: 'Leo', claimCode: 'ABCDE-FGHJK' };

describe('sendInviteEmail records the delivery verdict', () => {
  let writes: Array<{ sql: string; args: unknown[] }>;
  let env: Env;

  beforeEach(() => {
    writes = [];
    env = { DB: dbMock(writes) } as unknown as Env;
    dispatchMock.mockReset();
  });

  it('stores sent + a timestamp when the gateway delivered', async () => {
    dispatchMock.mockResolvedValue({ sent: true, messageId: 'msg_1' });

    const res = await sendInviteEmail(env, { ...args, claimId: 'inv_1' });

    expect(res.sent).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain('UPDATE workspace_invite_claims');
    const [status, sentAt, error, id] = writes[0].args;
    expect(status).toBe('sent');
    expect(String(sentAt)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(error).toBeNull();
    expect(id).toBe('inv_1');
  });

  it('stores failed + the error when the send threw upstream', async () => {
    dispatchMock.mockResolvedValue({ sent: false, error: 'Cloudflare Email Service error: domain not verified' });

    await sendInviteEmail(env, { ...args, claimId: 'inv_1' });

    const [status, sentAt, error] = writes[0].args;
    expect(status).toBe('failed');
    expect(sentAt).toBeNull();
    expect(error).toContain('domain not verified');
  });

  it('stores skipped + the reason when a gate blocked the send', async () => {
    dispatchMock.mockResolvedValue({ sent: false, skipped: 'disabled' });

    await sendInviteEmail(env, { ...args, claimId: 'inv_1' });

    const [status, , error] = writes[0].args;
    expect(status).toBe('skipped');
    expect(error).toBe('disabled');
  });

  it('writes nothing when no claim id was passed', async () => {
    dispatchMock.mockResolvedValue({ sent: true });

    await sendInviteEmail(env, args);

    expect(writes).toHaveLength(0);
  });

  it('never fails the invite because the bookkeeping write failed', async () => {
    dispatchMock.mockResolvedValue({ sent: true });
    const brokenEnv = { DB: dbMock(writes, { throwOnRun: true }) } as unknown as Env;

    await expect(sendInviteEmail(brokenEnv, { ...args, claimId: 'inv_1' })).resolves.toMatchObject({ sent: true });
  });
});
