// vitest-isolate: swaps the custom-hostname provider (module state).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { createSessionToken } from '../../../src/token';
import { getSessionUser } from '../../../src/auth/session';
import { clearWorkspaceHostMisses } from '../../../src/workspaces/host-cache';
import { setCustomHostnameProviderForTests } from '../../../src/workspaces/domains/provider';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';

const env = { ...baseEnv, SESSION_SECRET: 'f24-secret', SLUGS: undefined, CUSTOM_DOMAINS_CNAME_TARGET: 'customers.shareout.test' } as unknown as Env;
const HOST = 'evil.example';
const victim = { id: 'usr_f24_victim', email: 'victim@x.test' };
const admin = { id: 'usr_f24_admin', email: 'admin@x.test' };

const req = (url: string, cookie?: string) =>
  handleFetch(new Request(url, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' }), env);

beforeAll(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(victim.id, victim.email),
    env.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(admin.id, admin.email),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('ws_f24', 'Attacker', 'attacker-f24', ?)").bind(admin.id),
    env.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f24', 'ws_f24', ?, 'owner', 'internal')").bind(admin.id),
    env.DB.prepare("INSERT INTO workspace_domains (id, workspace_id, hostname, status, verification_method, verification_token) VALUES ('wd_f24', 'ws_f24', ?, 'active', 'http', 't')").bind(HOST),
  ]);
});
beforeEach(() => clearWorkspaceHostMisses());
afterAll(() => setCustomHostnameProviderForTests(null));

describe('f24 handoff', () => {
  const handoffCookie = async () => {
    const cookie = `shareout_session=${await createSessionToken(victim.id, victim.email, env)}`;
    const minted = await req(`https://shareout.test/auth/handoff?host=${HOST}&redirect=/`, cookie);
    expect(minted.status).toBe(302);
    const cb = new URL(minted.headers.get('Location')!);
    expect(cb.origin).toBe(`https://${HOST}`);
    const done = await req(cb.toString());
    return done.headers.get('Set-Cookie')!.split(';')[0];
  };

  it('blocks: the session redeemed on a custom host is not accepted on the apex', async () => {
    const token = await handoffCookie();
    const apex = await getSessionUser(new Request('https://shareout.test/home', { headers: { Cookie: token } }), env);
    expect(apex).toBeNull();
  });

  it('still signs in on the custom host it was minted for', async () => {
    const token = await handoffCookie();
    const user = await getSessionUser(new Request(`https://${HOST}/`, { headers: { Cookie: token } }), env);
    expect(user?.id).toBe(victim.id);
  });

  it('legacy tokens without an audience keep working on any host', async () => {
    const token = `shareout_session=${await createSessionToken(victim.id, victim.email, env)}`;
    for (const host of ['shareout.test', HOST]) {
      const user = await getSessionUser(new Request(`https://${host}/`, { headers: { Cookie: token } }), env);
      expect(user?.id).toBe(victim.id);
    }
  });
});
