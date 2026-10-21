import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';
import { handleCredentialsAuth, handlePasswordAuth } from '../../../src/auth/artifact-auth';

const store = new Map<string, string>();
const kv = {
  get: async (k: string) => store.get(k) ?? null,
  put: async (k: string, v: string) => void store.set(k, v),
  delete: async (k: string) => void store.delete(k),
};
const e = { ...baseEnv, SESSION_SECRET: 'test-session-secret', RATE_LIMIT_KV: kv } as unknown as Env;

const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

const form = (fields: Record<string, string>, ip = '203.0.113.7') => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request('https://shareout.test/auth/password', { method: 'POST', body: fd, headers: { 'cf-connecting-ip': ip } });
};

beforeAll(applyMigrations);
beforeEach(async () => {
  store.clear();
  await e.DB.prepare('DELETE FROM artifact_passwords').run();
  await e.DB.prepare("DELETE FROM artifacts WHERE id='art_f04'").run();
  await e.DB.prepare("INSERT OR IGNORE INTO users (id, email) VALUES ('usr_f04', 'f04@x.test')").run();
  await e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility, auth_method, password_hash) VALUES ('art_f04', 'A', 'f04', 'usr_f04', 'private', 'password', ?)")
    .bind(await sha('hunter2-correct')).run();
  await e.DB.prepare("INSERT INTO artifact_passwords (id, artifact_id, username, password_hash) VALUES ('crd_f04', 'art_f04', 'alice', ?)")
    .bind(await sha('alice-correct')).run();
});

const pw = (password: string, ip?: string) => handlePasswordAuth(form({ slug: 'f04', artifact_id: 'art_f04', password }, ip), e);
const cred = (password: string, ip?: string) => handleCredentialsAuth(form({ slug: 'f04', artifact_id: 'art_f04', username: 'alice', password }, ip), e);

describe('f04 artifact password / credentials gate', () => {
  it('blocks: repeated wrong guesses are throttled, even before the correct one', async () => {
    for (let i = 0; i < 60; i++) await pw(`wrong-${i}`);
    const res = await pw('hunter2-correct');
    expect(res.status).toBe(429);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('blocks: credentials gate is throttled too', async () => {
    for (let i = 0; i < 60; i++) await cred(`wrong-${i}`);
    expect((await cred('alice-correct')).status).toBe(429);
  });

  it('throttle is per client and artifact, not global', async () => {
    for (let i = 0; i < 60; i++) await pw(`wrong-${i}`);
    expect((await pw('hunter2-correct', '198.51.100.9')).status).toBe(302);
  });

  it('still accepts a legacy SHA-256 hash and transparently re-hashes it', async () => {
    const res = await pw('hunter2-correct');
    expect(res.status).toBe(302);
    const row = await e.DB.prepare("SELECT password_hash FROM artifacts WHERE id='art_f04'").first<{ password_hash: string }>();
    expect(row!.password_hash).toMatch(/^pbkdf2\$/);
    expect((await pw('hunter2-correct', '198.51.100.1')).status).toBe(302);
    expect((await pw('nope', '198.51.100.2')).status).toBe(401);
  });

  it('still accepts a legacy credential hash and transparently re-hashes it', async () => {
    expect((await cred('alice-correct')).status).toBe(302);
    const row = await e.DB.prepare("SELECT password_hash FROM artifact_passwords WHERE id='crd_f04'").first<{ password_hash: string }>();
    expect(row!.password_hash).toMatch(/^pbkdf2\$/);
    expect((await cred('alice-correct', '198.51.100.1')).status).toBe(302);
    expect((await cred('bad', '198.51.100.2')).status).toBe(401);
  });
});
