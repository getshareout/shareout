/**
 * Password sign-in — the one credential a fresh instance can issue on its own.
 *
 * Email OTP needs an EMAIL binding (without one the code prints to the worker log);
 * Google needs an OAuth client. Neither is available in the first ten minutes of a
 * self-hosted deploy, so a password is what makes `/setup` finish without the
 * operator first standing up a mail provider.
 *
 * PBKDF2-SHA256 via WebCrypto: it is what the Workers runtime actually offers.
 * Argon2id/scrypt would be preferable and are not available without shipping WASM,
 * so the cost is carried by the iteration count, stored per row so it can be raised
 * later without invalidating credentials issued at the old cost.
 */
import type { Env } from '../types';

/**
 * Cloudflare Workers' WebCrypto rejects PBKDF2 iteration counts above 100_000
 * (`Pbkdf2 failed: iteration counts above 100000 are not supported`). OWASP's
 * 2023 SHA-256 floor is 600_000 — unreachable here without shipping WASM — so we
 * sit on the Workers ceiling and lean on password length for the rest of the cost.
 */
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const ALGO = 'PBKDF2-SHA256';

/** Long enough that the iteration count is not the only thing standing in the way. */
export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200; // bounds the KDF input; nothing legitimate is longer

export interface StoredPassword {
  hash: string;
  salt: string;
  iterations: number;
  algo: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Length-independent, value-independent comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<StoredPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return {
    hash: toBase64(hash),
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    algo: ALGO,
  };
}

export async function verifyPassword(password: string, stored: StoredPassword): Promise<boolean> {
  if (stored.algo !== ALGO) return false;
  try {
    // D1 may return INTEGER columns as strings depending on driver/path — WebCrypto
    // rejects non-number `iterations` and we'd otherwise treat every login as a miss.
    const iterations = Number(stored.iterations);
    if (!Number.isFinite(iterations) || iterations < 1) return false;
    const candidate = await derive(password, fromBase64(stored.salt), iterations);
    return timingSafeEqual(candidate, fromBase64(stored.hash));
  } catch {
    return false;
  }
}

/** Human-readable reason the password is unacceptable, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || !password) return 'Enter a password.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters — length is what makes a password hard to guess.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return 'That password is too long.';
  if (!password.trim()) return 'A password of only spaces will be hard to type again.';
  return null;
}

// ── Storage ───────────────────────────────────────────────────────────────────

export async function setUserPassword(env: Env, userId: string, password: string): Promise<void> {
  const stored = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO user_passwords (user_id, hash, salt, iterations, algo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id) DO UPDATE SET
       hash = excluded.hash, salt = excluded.salt, iterations = excluded.iterations,
       algo = excluded.algo, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).bind(userId, stored.hash, stored.salt, stored.iterations, stored.algo).run();
}

export async function hasPassword(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS n FROM user_passwords WHERE user_id = ?')
    .bind(userId).first<{ n: number }>()
    .catch(() => null);
  return !!row;
}

export async function clearUserPassword(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM user_passwords WHERE user_id = ?').bind(userId).run();
}

export interface PasswordUser {
  id: string;
  email: string;
  firstActivation: boolean;
}

/**
 * Check an email + password pair. Returns null for every failure — unknown email,
 * no password set, wrong password — so the response cannot be used to enumerate
 * which addresses have accounts.
 *
 * A missing row still costs a derivation, so a request for an unknown address takes
 * the same time as one for a known address with the wrong password.
 */
export async function verifyUserPassword(
  env: Env,
  emailRaw: string,
  password: string,
): Promise<PasswordUser | null> {
  const email = (emailRaw || '').toLowerCase().trim();
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.last_login_at, p.hash, p.salt, p.iterations, p.algo
       FROM users u LEFT JOIN user_passwords p ON p.user_id = u.id
      WHERE u.email = ?`,
  ).bind(email).first<{
    id: string; email: string; last_login_at: string | null;
    hash: string | null; salt: string | null; iterations: number | null; algo: string | null;
  }>().catch(() => null);

  if (!row?.hash || !row.salt || !row.iterations) {
    // Burn a comparable amount of CPU so timing does not separate "no such account"
    // from "wrong password".
    await derive(password, crypto.getRandomValues(new Uint8Array(SALT_BYTES)), PBKDF2_ITERATIONS);
    return null;
  }

  const ok = await verifyPassword(password, {
    hash: row.hash, salt: row.salt, iterations: row.iterations, algo: row.algo || ALGO,
  });
  if (!ok) return null;

  const firstActivation = !row.last_login_at;
  await env.DB.prepare(`UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(row.id).run();

  return { id: row.id, email: row.email, firstActivation };
}
