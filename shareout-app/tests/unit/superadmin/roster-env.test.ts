// @vitest-environment node
// Deliberately does NOT mock superadmin-recipients.json — the shipped roster is empty,
// which is the state every self-hosted instance is in.
import { describe, expect, it } from 'vitest';
import { envAdminEmails, isSuperAdminEmail, rosterIsEmpty } from '../../../src/superadmin/recipients';
import type { Env } from '../../../src/types';

const env = (vars: Record<string, string> = {}) => vars as unknown as Env;

describe('instance admins on a self-hosted instance', () => {
  it('has no admin at all until something names one', () => {
    expect(rosterIsEmpty(env())).toBe(true);
    expect(isSuperAdminEmail('anyone@acme.test', env())).toBe(false);
  });

  // Consequence: with an admin named, `isFirstUserAdmin` in superadmin/auth.ts stops
  // handing the portal to whoever signed up first. That fallback is only meant to
  // cover an instance nobody has configured yet.
  it('is no longer empty once INSTANCE_ADMIN_EMAILS names someone', () => {
    expect(rosterIsEmpty(env({ INSTANCE_ADMIN_EMAILS: 'boss@acme.test' }))).toBe(false);
  });

  it('parses the list tolerantly', () => {
    expect(envAdminEmails(env({ INSTANCE_ADMIN_EMAILS: ' A@x.test ,, b@x.test,' })))
      .toEqual(['a@x.test', 'b@x.test']);
    expect(envAdminEmails(env({ INSTANCE_ADMIN_EMAILS: '' }))).toEqual([]);
    expect(envAdminEmails(env())).toEqual([]);
  });

  it('still honours SETUP_ADMIN_EMAIL, so the first admin cannot lock themselves out', () => {
    const e = env({ INSTANCE_ADMIN_EMAILS: 'boss@acme.test', SETUP_ADMIN_EMAIL: 'first@acme.test' });
    expect(isSuperAdminEmail('first@acme.test', e)).toBe(true);
    expect(isSuperAdminEmail('boss@acme.test', e)).toBe(true);
  });
});
