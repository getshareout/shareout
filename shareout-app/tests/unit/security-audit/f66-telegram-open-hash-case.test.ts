import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e as base } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';
import { handleTelegramOpen, signedOpenUrl } from '../../../src/telegram/open-link';

const BOT = '123:test-token';
const env = { ...base, TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_LOGIN_LINKS: '1', SESSION_SECRET: 'test-secret-f66' } as unknown as Env;
const USER = 'usr_f66';
const TG = '777';
const TO = '/a/acme/';

async function tap(openUrl: string, upper: boolean): Promise<Request> {
  const fields: Record<string, string> = { id: TG, first_name: 'A', auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(BOT));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(check)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const u = new URL(openUrl);
  for (const [k, v] of Object.entries(fields)) u.searchParams.set(k, v);
  u.searchParams.set('hash', upper ? mac.toUpperCase() : mac);
  return new Request(u.toString());
}

beforeAll(async () => {
  await applyMigrations();
  await base.DB.batch([
    base.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'f66@example.com', 'A')").bind(USER),
    base.DB.prepare("INSERT INTO messaging_links (platform, session_key, user_id, platform_user_id, linked_at) VALUES ('telegram', ?, ?, ?, '2026-10-01T00:00:00Z')").bind(TG, USER, TG),
  ]);
});

describe('f66 telegram open link single use', () => {
  it('blocks: an upper-case copy of a used hash cannot replay', async () => {
    const url = await signedOpenUrl(env, USER, TO);
    expect((await handleTelegramOpen(await tap(url, false), env)).headers.get('Set-Cookie')).toBeTruthy();
    expect((await handleTelegramOpen(await tap(url, true), env)).headers.get('Set-Cookie')).toBeNull();
  });
});
