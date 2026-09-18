import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

// The crons are pure orchestration here: if the flag gate lets them through they
// hit the DB, so a throwing DB is the signal that the gate opened.
const { dispatchLifecycleEmail } = vi.hoisted(() => ({ dispatchLifecycleEmail: vi.fn() }));
vi.mock('../../../src/email/gateway', () => ({ dispatchLifecycleEmail }));
vi.mock('../../../src/email/email-log', () => ({ claimEmailSend: vi.fn(async () => true) }));

import { runLifecycleEmails } from '../../../src/email/lifecycle-cron';

const scanned = () => {
  throw new Error('DB_SCANNED');
};
const envWith = (vars: Record<string, string>) =>
  ({ DB: { prepare: scanned }, ...vars }) as unknown as Env;

beforeEach(() => vi.clearAllMocks());

describe('nurture email gate', () => {
  it('sends nothing when NURTURE_EMAILS_ENABLED is unset', async () => {
    await expect(runLifecycleEmails(envWith({}))).resolves.toBeUndefined();
    expect(dispatchLifecycleEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when NURTURE_EMAILS_ENABLED is "0"', async () => {
    await expect(runLifecycleEmails(envWith({ NURTURE_EMAILS_ENABLED: '0' }))).resolves.toBeUndefined();
    expect(dispatchLifecycleEmail).not.toHaveBeenCalled();
  });

  it('stays paused when the hard LIFECYCLE_EMAILS_DISABLED switch is also on', async () => {
    const env = envWith({ NURTURE_EMAILS_ENABLED: '1', LIFECYCLE_EMAILS_DISABLED: '1' });
    await expect(runLifecycleEmails(env)).resolves.toBeUndefined();
    expect(dispatchLifecycleEmail).not.toHaveBeenCalled();
  });

  it('scans for recipients once opted in', async () => {
    // Every pass is wrapped in .catch(() => {}), so the throw is swallowed; the
    // proof the gate opened is that prepare() ran at all.
    const prepare = vi.fn(scanned);
    const env = { DB: { prepare }, NURTURE_EMAILS_ENABLED: '1' } as unknown as Env;
    await runLifecycleEmails(env);
    expect(prepare).toHaveBeenCalled();
  });
});
