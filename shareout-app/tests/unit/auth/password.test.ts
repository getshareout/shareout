// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  PBKDF2_ITERATIONS,
  hashPassword,
  passwordProblem,
  verifyPassword,
  verifyUserPassword,
} from '../../../src/auth/password';
import type { Env } from '../../../src/types';

describe('hashPassword / verifyPassword', () => {
  it('round-trips the right password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery stapler', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash, so identical passwords do not collide', async () => {
    const a = await hashPassword('the same password twice');
    const b = await hashPassword('the same password twice');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // Both still verify — the salt is what differs, not the secret.
    expect(await verifyPassword('the same password twice', a)).toBe(true);
    expect(await verifyPassword('the same password twice', b)).toBe(true);
  });

  it('records the cost so it can be raised later without breaking old hashes', async () => {
    const stored = await hashPassword('a sufficiently long password');
    expect(stored.iterations).toBe(PBKDF2_ITERATIONS);
    expect(stored.algo).toBe('PBKDF2-SHA256');

    // A hash written at a lower cost still verifies at its own recorded cost.
    const legacy = { ...stored, iterations: 1000 };
    expect(await verifyPassword('a sufficiently long password', legacy)).toBe(false);
  });

  it('refuses a digest written by an algorithm it does not know', async () => {
    const stored = await hashPassword('a sufficiently long password');
    expect(await verifyPassword('a sufficiently long password', { ...stored, algo: 'md5' })).toBe(false);
  });
});

describe('passwordProblem', () => {
  it('accepts a long-enough password', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it('rejects short, empty, blank, and absurdly long', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toContain('at least');
    expect(passwordProblem('')).toBe('Enter a password.');
    expect(passwordProblem(' '.repeat(MIN_PASSWORD_LENGTH))).toContain('only spaces');
    expect(passwordProblem('a'.repeat(500))).toContain('too long');
  });
});

// Routes each prepared SQL to a canned row.
function makeEnv(row: Record<string, unknown> | null): { env: Env; updates: string[] } {
  const updates: string[] = [];
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => (sql.includes('SELECT') ? row : null),
          run: async () => {
            updates.push(sql.replace(/\s+/g, ' ').trim());
            return { success: true };
          },
        }),
      }),
    },
  } as unknown as Env;
  return { env, updates };
}

describe('verifyUserPassword', () => {
  it('returns the user and stamps last_login_at on a match', async () => {
    const stored = await hashPassword('a sufficiently long password');
    const { env, updates } = makeEnv({
      id: 'usr_1', email: 'a@example.com', last_login_at: '2026-01-01', ...stored,
    });
    const user = await verifyUserPassword(env, 'A@Example.com ', 'a sufficiently long password');
    expect(user).toMatchObject({ id: 'usr_1', email: 'a@example.com', firstActivation: false });
    expect(updates.some((u) => u.includes('UPDATE users SET last_login_at'))).toBe(true);
  });

  it('flags a first activation when the user has never logged in', async () => {
    const stored = await hashPassword('a sufficiently long password');
    const { env } = makeEnv({ id: 'usr_1', email: 'a@example.com', last_login_at: null, ...stored });
    expect((await verifyUserPassword(env, 'a@example.com', 'a sufficiently long password'))?.firstActivation).toBe(true);
  });

  it('returns null on a wrong password, without stamping a login', async () => {
    const stored = await hashPassword('a sufficiently long password');
    const { env, updates } = makeEnv({ id: 'usr_1', email: 'a@example.com', last_login_at: null, ...stored });
    expect(await verifyUserPassword(env, 'a@example.com', 'not the password')).toBeNull();
    expect(updates).toHaveLength(0);
  });

  // Same null for "no such account", "no password set", and "wrong password" —
  // anything more specific tells an attacker which addresses have accounts.
  it('returns null for an unknown account', async () => {
    const { env } = makeEnv(null);
    expect(await verifyUserPassword(env, 'nobody@example.com', 'a sufficiently long password')).toBeNull();
  });

  it('returns null for a user with no password set', async () => {
    const { env } = makeEnv({
      id: 'usr_1', email: 'a@example.com', last_login_at: null,
      hash: null, salt: null, iterations: null, algo: null,
    });
    expect(await verifyUserPassword(env, 'a@example.com', 'a sufficiently long password')).toBeNull();
  });
});
