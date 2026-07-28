// P0 robustness: email OTP start/verify guards (invalid input, rate limits, wrong code).
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

vi.mock('../../../src/workspaces', async (orig) => {
  const actual = await orig<typeof import('../../../src/workspaces')>();
  return { ...actual, autoJoinWorkspacesByDomain: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../../src/superadmin/recipients', () => ({
  notifySuperadmins: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/email/gateway', () => ({
  dispatchLifecycleEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

import { startEmailOtp, verifyEmailOtp } from '../../../src/auth-otp';

const e = env as unknown as Env;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS email_otp_codes (id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, last_login_at TEXT)`,
    // signup-gate side tables (queried when SIGNUPS_PAUSED is on in test env)
    `CREATE TABLE IF NOT EXISTS collaborators (artifact_id TEXT, email TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, allowed_email_domains TEXT, allowed_emails TEXT)`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM email_otp_codes');
  await e.DB.exec('DELETE FROM users');
});

/** Epoch ms -> the TEXT timestamp format the schema stores. */
const iso = (ms: number) => new Date(ms).toISOString();

describe('startEmailOtp', () => {
  it('rejects invalid email', async () => {
    const r = await startEmailOtp(e, 'not-an-email');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('valid email') });
  });

  it('sends once then blocks resend inside the 30s window', async () => {
    expect((await startEmailOtp(e, 'a@example.com')).ok).toBe(true);
    const again = await startEmailOtp(e, 'a@example.com');
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/few seconds/i);
  });

  it('caps hourly sends', async () => {
    const email = 'spam@example.com';
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      await e.DB.prepare(
        'INSERT INTO email_otp_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(`otp_${i}`, email, 'h', iso(now + 60_000), iso(now - 60_000 - i)).run();
    }
    const r = await startEmailOtp(e, email);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Too many codes/i);
  });
});

describe('verifyEmailOtp', () => {
  it('rejects non-6-digit codes', async () => {
    const r = await verifyEmailOtp(e, 'a@example.com', '12');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('6-digit') });
  });

  it('rejects when no active code', async () => {
    const r = await verifyEmailOtp(e, 'a@example.com', '123456');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No active code/i);
  });

  it('rejects wrong code and increments attempts; locks after 5', async () => {
    const email = 'b@example.com';
    // Insert a known hash for code 000000 via start path is random — plant a row instead.
    const { sha256 } = await import('../../../src/crypto-utils');
    const hash = await sha256(new TextEncoder().encode(`${email}:999999`).buffer as ArrayBuffer);
    const now = Date.now();
    await e.DB.prepare(
      'INSERT INTO email_otp_codes (id, email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).bind('otp_x', email, hash, iso(now + 600_000), iso(now)).run();

    for (let i = 0; i < 5; i++) {
      const r = await verifyEmailOtp(e, email, '000000');
      expect(r.ok).toBe(false);
    }
    const locked = await verifyEmailOtp(e, email, '999999');
    expect(locked.ok).toBe(false);
    expect(locked.error).toMatch(/Too many tries/i);
  });

  it('accepts the correct code for an existing user and consumes it', async () => {
    // Test env has SIGNUPS_PAUSED=1 — mint OTP against a pre-existing user.
    const email = 'existing@example.com';
    await e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind('usr_ex', email, 'Ex').run();
    const { sha256 } = await import('../../../src/crypto-utils');
    const code = '424242';
    const hash = await sha256(new TextEncoder().encode(`${email}:${code}`).buffer as ArrayBuffer);
    const now = Date.now();
    await e.DB.prepare(
      'INSERT INTO email_otp_codes (id, email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).bind('otp_ok', email, hash, iso(now + 600_000), iso(now)).run();

    const r = await verifyEmailOtp(e, email, code);
    expect(r.ok).toBe(true);
    // Pre-created row with no last_login_at → firstActivation (invitee path).
    expect(r.user).toEqual({ id: 'usr_ex', email, isNew: false, firstActivation: true });

    // Code is consumed — second verify fails.
    const again = await verifyEmailOtp(e, email, code);
    expect(again.ok).toBe(false);
  });

  it('blocks brand-new signups while SIGNUPS_PAUSED', async () => {
    const email = 'brandnew@example.com';
    const { sha256 } = await import('../../../src/crypto-utils');
    const code = '555555';
    const hash = await sha256(new TextEncoder().encode(`${email}:${code}`).buffer as ArrayBuffer);
    const now = Date.now();
    await e.DB.prepare(
      'INSERT INTO email_otp_codes (id, email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).bind('otp_paused', email, hash, iso(now + 600_000), iso(now)).run();

    const r = await verifyEmailOtp(e, email, code);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/paused/i);
  });

  it('rejects expired codes', async () => {
    const email = 'old@example.com';
    const { sha256 } = await import('../../../src/crypto-utils');
    const hash = await sha256(new TextEncoder().encode(`${email}:111111`).buffer as ArrayBuffer);
    await e.DB.prepare(
      'INSERT INTO email_otp_codes (id, email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).bind('otp_old', email, hash, iso(Date.now() - 1), iso(Date.now() - 60_000)).run();

    const r = await verifyEmailOtp(e, email, '111111');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expired/i);
  });
});
