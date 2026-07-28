// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// The shipped roster is empty by design (a public repo must not grant super-admin to a
// baked-in address), so tests that need one mock the roster import.
const testRoster = vi.hoisted(() => ({
  default: {
    recipients: [{ email: 'admin@example.com', telegramChatId: 555000 }, { email: 'ops@example.com' }],
  },
}));
vi.mock('../../superadmin-recipients.json', () => testRoster);

import {
  SUPERADMIN_EMAILS,
  SUPERADMIN_RECIPIENTS,
  configuredSuperadminTelegramChatIds,
  isSuperAdminEmail,
  rosterIsEmpty,
} from '../../src/superadmin/recipients';

describe('superadmin roster', () => {
  it('loads a configured roster into recipients.ts', () => {
    expect(SUPERADMIN_RECIPIENTS).toEqual(testRoster.default.recipients);
    expect(SUPERADMIN_EMAILS).toEqual(['admin@example.com', 'ops@example.com']);
    expect(rosterIsEmpty()).toBe(false);
  });

  it('recognizes roster emails for portal access', () => {
    expect(isSuperAdminEmail('admin@example.com')).toBe(true);
    expect(isSuperAdminEmail('ADMIN@example.com')).toBe(true);
    expect(isSuperAdminEmail('random@example.com')).toBe(false);
  });

  it('accepts SETUP_ADMIN_EMAIL as the bootstrap super-admin', () => {
    const env = { SETUP_ADMIN_EMAIL: 'owner@example.com' } as never;
    expect(isSuperAdminEmail('owner@example.com', env)).toBe(true);
    expect(isSuperAdminEmail('OWNER@example.com ', env)).toBe(true);
    expect(isSuperAdminEmail('someone@example.com', env)).toBe(false);
  });

  // The self-host path: adding an instance admin should not mean editing a file in
  // the repo and redeploying a fork.
  it('accepts INSTANCE_ADMIN_EMAILS from the environment', () => {
    const env = { INSTANCE_ADMIN_EMAILS: ' Boss@Acme.test , ops2@acme.test ' } as never;
    expect(isSuperAdminEmail('boss@acme.test', env)).toBe(true);
    expect(isSuperAdminEmail('ops2@acme.test', env)).toBe(true);
    expect(isSuperAdminEmail('nobody@acme.test', env)).toBe(false);
    // Without the env it is not an admin — the var is the only thing granting it.
    expect(isSuperAdminEmail('boss@acme.test')).toBe(false);
  });

  it('exposes configured telegram chat ids for admin notifications', () => {
    expect(configuredSuperadminTelegramChatIds()).toEqual([555000]);
  });
});
