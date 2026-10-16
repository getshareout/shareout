// One-tap page links from Telegram: signs in only the linked member, only for the signed
// page, only once and only fresh; every failure is a plain redirect to the page's own gate.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e as base } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';
import { handleTelegramOpen, openPageButton, signedOpenUrl, verifyTelegramLogin } from '../../../src/telegram/open-link';

const BOT = '123:test-token';
const env = { ...base, TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_LOGIN_LINKS: '1', SESSION_SECRET: 'test-secret-for-open-links' } as unknown as Env;
const USER = 'usr_tgopen_alice';
const TG_ID = '424242';
const TO = '/a/acme-procedures/?page=procedures/waste.html&section=sec-3';

async function telegramSign(fields: Record<string, string>): Promise<string> {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(BOT));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(check)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What Telegram opens when `tgId` taps the login_url button. */
async function tap(openUrl: string, tgId = TG_ID, authDate = Math.floor(Date.now() / 1000)): Promise<Request> {
  const fields = { id: tgId, first_name: 'Alice', auth_date: String(authDate) };
  const u = new URL(openUrl);
  for (const [k, v] of Object.entries(fields)) u.searchParams.set(k, v);
  u.searchParams.set('hash', await telegramSign(fields));
  return new Request(u.toString());
}

beforeAll(async () => {
  await applyMigrations();
  await base.DB.batch([
    base.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'alice-tg@example.com', 'Alice')").bind(USER),
    base.DB.prepare("INSERT INTO messaging_links (platform, session_key, user_id, platform_user_id, linked_at) VALUES ('telegram', ?, ?, ?, '2026-10-01T00:00:00Z')").bind(TG_ID, USER, TG_ID),
  ]);
});

describe('Telegram one-tap page links', () => {
  it('builds a login_url button only for this instance\'s page links, and only when enabled', async () => {
    const b = await openPageButton(env, USER, 'Open', `https://shareout.test${TO}`);
    expect(b).toHaveProperty('login_url.url');
    expect(await openPageButton(env, USER, 'Open', 'https://elsewhere.example.com/a/x/')).toEqual({ text: 'Open', url: 'https://elsewhere.example.com/a/x/' });
    expect(await openPageButton({ ...env, TELEGRAM_LOGIN_LINKS: undefined } as Env, USER, 'Open', `https://shareout.test${TO}`)).toHaveProperty('url');
  });

  it('signs the linked member in and lands on the exact sub-page and section', async () => {
    const res = await handleTelegramOpen(await tap(await signedOpenUrl(env, USER, TO)), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(TO);
    expect(res.headers.get('Set-Cookie')).toMatch(/HttpOnly/);
  });

  it('a replayed, forwarded, stale or tampered link only redirects (no session)', async () => {
    const url = await signedOpenUrl(env, USER, TO);
    const once = await tap(url, TG_ID, Math.floor(Date.now() / 1000) - 5);
    expect((await handleTelegramOpen(once.clone(), env)).headers.get('Set-Cookie')).toBeTruthy();
    expect((await handleTelegramOpen(once, env)).headers.get('Set-Cookie')).toBeNull();

    const forwarded = await handleTelegramOpen(await tap(url, '999999'), env);
    expect(forwarded.headers.get('Set-Cookie')).toBeNull();
    expect(forwarded.headers.get('Location')).toBe(TO);

    const stale = await handleTelegramOpen(await tap(url, TG_ID, Math.floor(Date.now() / 1000) - 3600), env);
    expect(stale.headers.get('Set-Cookie')).toBeNull();

    const other = new URL(url);
    other.searchParams.set('to', '/a/someone-elses-page/');
    const tampered = await handleTelegramOpen(await tap(other.toString()), env);
    expect(tampered.headers.get('Set-Cookie')).toBeNull();
    expect(tampered.headers.get('Location')).toBe('/a/someone-elses-page/');
  });

  it('never redirects off-site', async () => {
    const res = await handleTelegramOpen(new Request('https://shareout.test/auth/telegram/open?to=//evil.example.com/a/x/'), env);
    expect(res.status).toBe(404);
  });

  it('rejects a bad Telegram signature', async () => {
    const p = new URLSearchParams({ id: TG_ID, auth_date: String(Math.floor(Date.now() / 1000)), hash: 'ab'.repeat(32) });
    expect(await verifyTelegramLogin(p, BOT)).toBeNull();
  });
});
