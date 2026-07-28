// P2 robustness: /v1/email/* + email-events webhook (auth, token, suppressions).
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';

const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/auth', () => ({ getSessionUser }));

import { routeEmail } from '../../../src/email/routes';
import { createUnsubscribeToken } from '../../../src/email/unsubscribe-token';

const e = env as unknown as Env;
Object.assign(e, {
  SESSION_SECRET: 'test-session-secret',
  SHAREOUT_BASE_URL: 'https://shareout.site',
  EMAIL_WEBHOOK_SECRET: 'whsec',
});

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS email_suppressions (email TEXT PRIMARY KEY, user_id TEXT, reason TEXT, kind TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS email_preferences (user_id TEXT NOT NULL, category TEXT NOT NULL, opted_in INTEGER NOT NULL, updated_at TEXT, PRIMARY KEY (user_id, category))`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM email_suppressions');
  await e.DB.exec('DELETE FROM email_preferences');
  getSessionUser.mockReset().mockResolvedValue(null);
});

function ctx(path: string, init: RequestInit = {}) {
  return createFetchContext(new Request(`https://shareout.site${path}`, init), e);
}

describe('routeEmail webhook', () => {
  it('returns null for unmatched paths', async () => {
    expect(await routeEmail(ctx('/v1/other'))).toBeNull();
  });

  it('401s email-events when secret mismatches', async () => {
    const res = await routeEmail(ctx('/v1/webhooks/email-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'wrong' },
      body: '[]',
    }));
    expect(res?.status).toBe(401);
  });

  it('400s invalid JSON; suppresses bounce and complaint events', async () => {
    const bad = await routeEmail(ctx('/v1/webhooks/email-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'whsec' },
      body: 'not-json',
    }));
    expect(bad?.status).toBe(400);

    const ok = await routeEmail(ctx('/v1/webhooks/email-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'whsec' },
      body: JSON.stringify([
        { email: 'bounce@x.com', type: 'bounce' },
        { recipient: 'spam@x.com', event: 'complaint' },
        { type: 'delivered' }, // no email → skip
      ]),
    }));
    expect(ok?.status).toBe(200);
    expect(await ok!.json()).toEqual({ ok: true, suppressed: 2 });

    const row = await e.DB.prepare('SELECT reason FROM email_suppressions WHERE email = ?')
      .bind('bounce@x.com').first<{ reason: string }>();
    expect(row?.reason).toBe('bounce');
  });
});

describe('routeEmail preferences + center', () => {
  it('401s preferences without session', async () => {
    expect((await routeEmail(ctx('/v1/email/preferences')))?.status).toBe(401);
    expect((await routeEmail(ctx('/v1/email/center')))?.status).toBe(401);
  });

  it('GET preferences and POST toggle for signed-in user', async () => {
    getSessionUser.mockResolvedValue({ id: 'usr_1', email: 'u@x.com' });

    const get = await routeEmail(ctx('/v1/email/preferences'));
    expect(get?.status).toBe(200);
    const { preferences } = await get!.json() as { preferences: { category: string; optedIn: boolean }[] };
    expect(preferences.map(p => p.category)).toEqual(['product', 'commercial', 'marketing']);

    const bad = await routeEmail(ctx('/v1/email/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'nope', optedIn: true }),
    }));
    expect(bad?.status).toBe(400);

    const post = await routeEmail(ctx('/v1/email/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'marketing', optedIn: true }),
    }));
    expect(post?.status).toBe(200);
    expect(await post!.json()).toEqual({ ok: true });

    const stored = await e.DB.prepare(
      'SELECT opted_in FROM email_preferences WHERE user_id = ? AND category = ?',
    ).bind('usr_1', 'marketing').first<{ opted_in: number }>();
    expect(stored?.opted_in).toBe(1);

    const center = await routeEmail(ctx('/v1/email/center'));
    expect(center?.status).toBe(200);
    expect(center!.headers.get('Content-Type')).toMatch(/html/);
    expect(await center!.text()).toMatch(/Email preferences|marketing|u@x\.com/i);
  });
});

describe('routeEmail unsubscribe', () => {
  it('400s invalid token', async () => {
    const res = await routeEmail(ctx('/v1/email/unsubscribe?token=garbage'));
    expect(res?.status).toBe(400);
    expect(await res!.text()).toMatch(/invalid or expired/i);
  });

  it('opts out via signed token (GET html + POST bare 200)', async () => {
    const token = await createUnsubscribeToken(e, 'usr_2', 'product');
    const get = await routeEmail(ctx(`/v1/email/unsubscribe?token=${encodeURIComponent(token)}`));
    expect(get?.status).toBe(200);
    expect(await get!.text()).toMatch(/unsubscribed/i);

    const pref = await e.DB.prepare(
      'SELECT opted_in FROM email_preferences WHERE user_id = ? AND category = ?',
    ).bind('usr_2', 'product').first<{ opted_in: number }>();
    expect(pref?.opted_in).toBe(0);

    const token2 = await createUnsubscribeToken(e, 'usr_3', 'commercial');
    const post = await routeEmail(ctx(`/v1/email/unsubscribe?token=${encodeURIComponent(token2)}`, {
      method: 'POST',
    }));
    expect(post?.status).toBe(200);
    expect(await post!.text()).toBe('OK');
  });
});
