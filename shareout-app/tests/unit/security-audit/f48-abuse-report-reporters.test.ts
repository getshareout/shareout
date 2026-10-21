// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleAbuseReport } from '../../../src/moderation/abuse-reports';
import { createSessionToken } from '../../../src/token';

const kv = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;
const env = Object.assign(e, { RATE_LIMIT_KV: kv }) as typeof e;

const report = (art: string, ip: string, category: string, cookie?: string, target = env) =>
  handleAbuseReport(new Request(`https://shareout.example.com/report/${art}`, {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip, ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams({ category }),
  }), target, art);

const status = async (id: string) =>
  (await e.DB.prepare('SELECT status FROM artifact_moderation WHERE artifact_id = ?').bind(id).first<{ status: string }>())?.status ?? 'approved';

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f48';
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_f48r_1','r1@x.test'), ('usr_f48r_2','r2@x.test'), ('usr_f48r_3','r3@x.test'), ('usr_f48r_o','o@x.test')"),
    ...['same24', 'v6', 'users', 'nokv', 'spread'].map((n) => e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, 'usr_f48r_o', 'public')").bind(`art_f48r_${n}`, n, `f48r-${n}`)),
  ]);
});

describe('f48 distinct reporters', () => {
  it('blocks: many reports from one /24 do not auto-block', async () => {
    for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3', '203.0.113.4']) await report('art_f48r_same24', ip, 'spam');
    expect(await status('art_f48r_same24')).toBe('approved');
  });

  it('blocks: many reports from one /48 do not auto-block', async () => {
    for (const ip of ['2001:db8:1::1', '2001:db8:1:5::2', '2001:db8:1:9::3']) await report('art_f48r_v6', ip, 'spam');
    expect(await status('art_f48r_v6')).toBe('approved');
  });

  it('three different networks still auto-block', async () => {
    for (const ip of ['203.0.113.1', '198.51.100.1', '192.0.2.1']) await report('art_f48r_spread', ip, 'spam');
    expect(await status('art_f48r_spread')).toBe('blocked');
  });

  it('three signed-in users on one network auto-block', async () => {
    for (const n of [1, 2, 3]) {
      const t = await createSessionToken(`usr_f48r_${n}`, `r${n}@x.test`, e);
      await report('art_f48r_users', '203.0.113.7', 'spam', `shareout_session=${t}`);
    }
    expect(await status('art_f48r_users')).toBe('blocked');
  });

  it('blocks: fails closed when the rate-limit KV is not bound', async () => {
    const res = await report('art_f48r_nokv', '203.0.113.50', 'csam', undefined, { ...e, RATE_LIMIT_KV: undefined } as typeof e);
    expect(res.status).toBe(503);
    expect(await status('art_f48r_nokv')).toBe('approved');
  });
});
