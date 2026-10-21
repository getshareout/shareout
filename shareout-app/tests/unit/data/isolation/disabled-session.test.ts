// Session cookies on the data plane go through the same disabled-user check as the app.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../../helpers/migrated-db';
import { createAccessToken, createSessionToken } from '../../../../src/token';
import { verifyLiveSessionToken } from '../../../../src/auth/session';
import { resolveRequesterUserId, type DataContext } from '../../../../src/data/middleware';
import { getSession } from '../../../../src/data/slides/auth';
import type { Env } from '../../../../src/types';

const env = { ...e, SESSION_SECRET: 'test-session-secret' } as Env;
const ACTIVE = 'usr_dsess_active';
const DISABLED = 'usr_dsess_disabled';

const req = (token: string) => new Request('https://shareout.test/v1/data/x', { headers: { Cookie: `shareout_session=${token}` } });
const ctx = { env, artifactId: 'art_dsess' } as unknown as DataContext;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.prepare("INSERT INTO users (id, email, name, disabled) VALUES (?, 'active@example.com', 'a', 0), (?, 'disabled@example.com', 'd', 1)")
    .bind(ACTIVE, DISABLED).run();
});

describe('data-plane session verification', () => {
  it('accepts an active user session', async () => {
    const token = await createSessionToken(ACTIVE, 'active@example.com', env);
    expect(await verifyLiveSessionToken(token, env, new Request('https://shareout.test/'))).toEqual({ userId: ACTIVE, email: 'active@example.com' });
    expect(await resolveRequesterUserId(req(token), ctx)).toBe(ACTIVE);
    expect(await getSession(req(token), ctx)).toMatchObject({ userId: ACTIVE });
  });

  it('refuses a disabled user session', async () => {
    const token = await createSessionToken(DISABLED, 'disabled@example.com', env);
    expect(await verifyLiveSessionToken(token, env, new Request('https://shareout.test/'))).toBeNull();
    expect(await resolveRequesterUserId(req(token), ctx)).toBeNull();
    expect(await getSession(req(token), ctx)).toBeNull();
  });

  it('refuses an artifact access token presented as a session cookie', async () => {
    const token = await createAccessToken('art_dsess', 'viewer', env, 3600, 'active@example.com');
    expect(await verifyLiveSessionToken(token, env, new Request('https://shareout.test/'))).toBeNull();
    expect(await getSession(req(token), ctx)).toBeNull();
  });
});
