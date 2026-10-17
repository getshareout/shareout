// vitest-isolate: swaps the custom-hostname provider (module state).
// Workspace custom domains against the real migrated schema, through the real
// dispatcher. Cloudflare's Custom Hostnames API is a local fake; nothing leaves the test.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { createSessionToken } from '../../../src/token';
import { clearWorkspaceHostMisses, workspaceByHostname } from '../../../src/workspaces/host-cache';
import { normalizeHostname, unclaimableReason } from '../../../src/workspaces/domains/hostname';
import { cloudflareProvider, manualProvider, ProviderError, setCustomHostnameProviderForTests } from '../../../src/workspaces/domains/provider';
import { addDomain, DomainError, refreshDomain, STALE_CLAIM_MS } from '../../../src/workspaces/domains/store';
import { consumeHandoffCode, mintHandoffCode } from '../../../src/workspaces/domains/handoff';
import { provisionWorkspaceDomain, workspaceArtifactUrl } from '../../../src/workspaces/domains';
import { buildWorkspaceUrls } from '../../../src/publish/deployment';
import { inviteLandingUrl } from '../../../src/workspaces-invite-email';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';

const env = {
  ...baseEnv,
  SESSION_SECRET: 'domains-secret',
  SLUGS: undefined,
  CUSTOM_DOMAINS_CNAME_TARGET: 'customers.shareout.test',
} as unknown as Env;

const A = 'ws_cd_a';
const B = 'ws_cd_b';
const owner = { id: 'usr_cd_owner', email: 'owner@acme.example' };
const admin = { id: 'usr_cd_admin', email: 'admin@acme.example' };
const member = { id: 'usr_cd_member', email: 'member@acme.example' };
const ownerB = { id: 'usr_cd_ownerb', email: 'owner@globex.example' };

/** In-memory Cloudflare Custom Hostnames API. */
function fakeCloudflare() {
  const hosts = new Map<string, { id: string; hostname: string; status: string; ssl: { status: string } }>();
  const calls: Array<{ method: string; url: string; auth: string | null; body: unknown }> = [];
  let failDelete = false;
  let n = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, auth: new Headers(init?.headers).get('Authorization'), body });
    const ok = (result: unknown, status = 200) => new Response(JSON.stringify({ success: true, errors: [], result }), { status });
    const m = url.match(/\/zones\/zone_test\/custom_hostnames(?:\/([^/?]+))?$/);
    if (!m) return new Response('unexpected', { status: 500 });
    const id = m[1];
    if (method === 'POST' && !id) {
      const rec = { id: `cfh_${++n}`, hostname: body.hostname, status: 'pending', ssl: { status: 'pending_validation' } };
      hosts.set(rec.id, rec);
      return ok({ ...rec, ownership_verification: { type: 'txt', name: `_cf-custom-hostname.${body.hostname}`, value: `uuid-${rec.id}` } });
    }
    const rec = id ? hosts.get(id) : undefined;
    if (!rec) return new Response(JSON.stringify({ success: false, errors: [{ code: 1436, message: 'not found' }] }), { status: 404 });
    if (method === 'GET' || method === 'PATCH') {
      return ok({ ...rec, ownership_verification: { type: 'txt', name: `_cf-custom-hostname.${rec.hostname}`, value: `uuid-${rec.id}` } });
    }
    if (method === 'DELETE') {
      if (failDelete) return new Response(JSON.stringify({ success: false, errors: [{ message: 'boom' }] }), { status: 500 });
      hosts.delete(rec.id);
      return ok({ id: rec.id });
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;
  return {
    fetchFn, hosts, calls,
    activate(hostname: string) { for (const h of hosts.values()) if (h.hostname === hostname) { h.status = 'active'; h.ssl.status = 'active'; } },
    setFailDelete(v: boolean) { failDelete = v; },
  };
}

let cf = fakeCloudflare();

async function cookieFor(u: { id: string; email: string }) {
  return `shareout_session=${await createSessionToken(u.id, u.email, env)}`;
}

function req(url: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('Cookie', init.cookie);
  if (init.body) headers.set('Content-Type', 'application/json');
  return handleFetch(new Request(url, { ...init, headers, redirect: 'manual' }), env);
}

async function activeDomain(workspaceId: string, hostname: string) {
  const { row } = await addDomain(env, { workspaceId, hostname, actorId: null });
  cf.activate(hostname);
  return refreshDomain(env, workspaceId, row.id);
}

beforeAll(async () => {
  await applyMigrations();
  const users = [owner, admin, member, ownerB];
  await env.DB.batch([
    ...users.map((u) => env.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email)),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-cd', ?)").bind(A, owner.id),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Globex', 'globex-cd', ?)").bind(B, ownerB.id),
    env.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_cd1', ?, ?, 'owner', 'internal'), ('wm_cd2', ?, ?, 'admin', 'internal'), ('wm_cd3', ?, ?, 'member', 'internal'), ('wm_cd4', ?, ?, 'owner', 'internal')`)
      .bind(A, owner.id, A, admin.id, A, member.id, B, ownerB.id),
  ]);
});

beforeEach(async () => {
  cf = fakeCloudflare();
  setCustomHostnameProviderForTests(cloudflareProvider('cf-token', 'zone_test', cf.fetchFn));
  clearWorkspaceHostMisses();
  await env.DB.prepare('DELETE FROM workspace_domains').run();
  await env.DB.prepare('DELETE FROM workspace_domain_handoffs').run();
});

afterAll(() => setCustomHostnameProviderForTests(null));

describe('hostname rules', () => {
  it('normalizes case, trailing dot and IDNs to punycode', () => {
    expect(normalizeHostname(' Portal.ACME.example. ')).toBe('portal.acme.example');
    expect(normalizeHostname('bücher.example')).toBe('xn--bcher-kva.example');
  });
  it('rejects URLs, ports, IPs and single labels', () => {
    for (const bad of ['https://portal.acme.example', 'portal.acme.example:8443', 'portal.acme.example/x', '10.0.0.1', 'localhost', '-a.example', '']) {
      expect(normalizeHostname(bad), bad).toBeNull();
    }
  });
  it('never lets a workspace claim a hostname the instance serves', () => {
    expect(unclaimableReason(env, 'shareout.test')).toBeTruthy();
    expect(unclaimableReason(env, 'other-ws.shareout.test')).toBeTruthy();
    expect(unclaimableReason(env, 'customers.shareout.test')).toBeTruthy();
    expect(unclaimableReason(env, 'x.workers.dev')).toBeTruthy();
    expect(unclaimableReason(env, 'portal.acme.example')).toBeNull();
  });
});

describe('Cloudflare custom hostnames provider (mocked API)', () => {
  it('add posts the hostname with DV/HTTP and returns the TXT ownership record', async () => {
    const p = cloudflareProvider('cf-token', 'zone_test', cf.fetchFn);
    const st = await p.create('portal.acme.example', 'ignored');
    expect(cf.calls[0]).toMatchObject({ method: 'POST', url: 'https://api.cloudflare.com/client/v4/zones/zone_test/custom_hostnames', auth: 'Bearer cf-token' });
    expect(cf.calls[0]!.body).toMatchObject({ hostname: 'portal.acme.example', ssl: { method: 'http', type: 'dv' } });
    expect(st).toMatchObject({ providerId: 'cfh_1', active: false, verification: { name: '_cf-custom-hostname.portal.acme.example', value: 'uuid-cfh_1' } });
  });
  it('status is active only when hostname AND certificate are active; pending nudges DCV', async () => {
    const p = cloudflareProvider('cf-token', 'zone_test', cf.fetchFn);
    await p.create('portal.acme.example', 'x');
    expect((await p.refresh('portal.acme.example', 'cfh_1', 'x')).active).toBe(false);
    expect(cf.calls.map((c) => c.method)).toEqual(['POST', 'GET', 'PATCH']);
    cf.activate('portal.acme.example');
    expect((await p.refresh('portal.acme.example', 'cfh_1', 'x')).active).toBe(true);
  });
  it('delete removes it; an already-gone hostname is fine; other failures throw', async () => {
    const p = cloudflareProvider('cf-token', 'zone_test', cf.fetchFn);
    await p.create('portal.acme.example', 'x');
    await p.remove('cfh_1');
    expect(cf.hosts.size).toBe(0);
    await expect(p.remove('cfh_1')).resolves.toBeUndefined();
    await p.create('b.acme.example', 'x');
    cf.setFailDelete(true);
    await expect(p.remove('cfh_2')).rejects.toBeInstanceOf(ProviderError);
  });
  it('manual mode activates only when the TXT record carries the token', async () => {
    let txt: string[] = [];
    const dns = (async () => new Response(JSON.stringify({ Answer: txt.map((d) => ({ type: 16, data: `"${d}"` })) }))) as unknown as typeof fetch;
    const p = manualProvider(dns);
    const st = await p.create('portal.acme.example', 'tok-1');
    expect(st.verification).toEqual({ method: 'dns_txt', name: '_shareout-verify.portal.acme.example', value: 'tok-1' });
    expect((await p.refresh('portal.acme.example', null, 'tok-1')).active).toBe(false);
    txt = ['someone-else'];
    expect((await p.refresh('portal.acme.example', null, 'tok-1')).active).toBe(false);
    txt = ['tok-1'];
    expect((await p.refresh('portal.acme.example', null, 'tok-1')).active).toBe(true);
  });
});

describe('routing by custom host', () => {
  it('an unknown host gets the 404, never another workspace', async () => {
    await activeDomain(A, 'portal.acme.example');
    const res = await req('https://unknown.example/', { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(404);
    const api = await req('https://unknown.example/v1/auth/session');
    expect(api.status).toBe(404);
  });

  it('a pending host is not routed', async () => {
    await addDomain(env, { workspaceId: A, hostname: 'portal.acme.example', actorId: owner.id });
    expect((await req('https://portal.acme.example/')).status).toBe(404);
    expect(await workspaceByHostname(env, 'portal.acme.example')).toBeNull();
  });

  it('an active host resolves to its workspace exactly like the subdomain', async () => {
    await activeDomain(A, 'portal.acme.example');
    const anon = await req('https://portal.acme.example/');
    expect(anon.status).toBe(302);
    expect(anon.headers.get('Location')).toBe('/auth/login?redirect=/');
    // Same request on the subdomain, for parity.
    const sub = await req('https://acme-cd.shareout.test/');
    expect(sub.headers.get('Location')).toBe(anon.headers.get('Location'));
  });

  it('the CNAME target itself is not a workspace', async () => {
    expect((await req('https://customers.shareout.test/')).status).toBe(404);
  });

  it('removing the host stops routing and takes it off Cloudflare', async () => {
    const row = await activeDomain(A, 'portal.acme.example');
    const del = await req(`https://shareout.test/v1/workspaces/${A}/domains/${row.id}`, { method: 'DELETE', cookie: await cookieFor(owner) });
    expect(del.status).toBe(200);
    expect(cf.calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/custom_hostnames/${row.provider_id}`))).toBe(true);
    expect((await req('https://portal.acme.example/')).status).toBe(404);
  });

  it('a failed Cloudflare delete keeps the row (no orphaned hostname on the zone)', async () => {
    const row = await activeDomain(A, 'portal.acme.example');
    cf.setFailDelete(true);
    const del = await req(`https://shareout.test/v1/workspaces/${A}/domains/${row.id}`, { method: 'DELETE', cookie: await cookieFor(owner) });
    expect(del.status).toBe(502);
    expect(await workspaceByHostname(env, 'portal.acme.example')).toEqual({ id: A, slug: 'acme-cd' });
  });
});

describe('managing domains', () => {
  it('owners and admins can add; members and outsiders cannot', async () => {
    const add = async (u: { id: string; email: string }, hostname: string) =>
      req(`https://shareout.test/v1/workspaces/${A}/domains`, { method: 'POST', body: JSON.stringify({ hostname }), cookie: await cookieFor(u) });
    expect((await add(member, 'm.acme.example')).status).toBe(403);
    expect((await add(ownerB, 'x.acme.example')).status).toBe(403);
    const byAdmin = await add(admin, 'Portal.Acme.Example');
    expect(byAdmin.status).toBe(201);
    const body = await byAdmin.json() as { domain: { hostname: string; status: string; dns: Array<{ type: string; name: string; value: string }> } };
    expect(body.domain).toMatchObject({ hostname: 'portal.acme.example', status: 'pending' });
    expect(body.domain.dns).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'CNAME', name: 'portal.acme.example', value: 'customers.shareout.test' }),
      expect.objectContaining({ type: 'TXT', name: '_cf-custom-hostname.portal.acme.example' }),
    ]));
    expect((await add(owner, 'owner.acme.example')).status).toBe(201);
    const list = await req(`https://shareout.test/v1/workspaces/${A}/domains`, { cookie: await cookieFor(member) });
    expect(list.status).toBe(403);
  });

  it('only an active domain can be primary', async () => {
    const { row } = await addDomain(env, { workspaceId: A, hostname: 'portal.acme.example', actorId: null });
    const res = await req(`https://shareout.test/v1/workspaces/${A}/domains/${row.id}`, { method: 'PATCH', body: JSON.stringify({ primary: true }), cookie: await cookieFor(owner) });
    expect(res.status).toBe(409);
  });

  it('a disabled instance refuses to add', async () => {
    const off = { ...env, CUSTOM_DOMAINS_CNAME_TARGET: undefined } as Env;
    const res = await handleFetch(new Request(`https://shareout.test/v1/workspaces/${A}/domains`, {
      method: 'POST', body: JSON.stringify({ hostname: 'portal.acme.example' }),
      headers: { Cookie: await cookieFor(owner), 'Content-Type': 'application/json' },
    }), off);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('CUSTOM_DOMAINS_DISABLED');
  });

  it('the provisioning hook claims a hostname and returns the DNS steps', async () => {
    const view = await provisionWorkspaceDomain(env, { workspaceId: A, hostname: 'portal.acme.example' });
    expect(view.status).toBe('pending');
    expect(view.instructions.join(' ')).toContain('customers.shareout.test');
  });
});

describe('takeover protection', () => {
  it('an active hostname of workspace A can never be claimed by workspace B', async () => {
    await activeDomain(A, 'portal.acme.example');
    await expect(addDomain(env, { workspaceId: B, hostname: 'portal.acme.example', actorId: ownerB.id }))
      .rejects.toMatchObject({ status: 409, code: 'HOSTNAME_TAKEN' });
    // Even after a long time.
    await env.DB.prepare("UPDATE workspace_domains SET created_at = '2000-01-01T00:00:00.000Z'").run();
    await expect(addDomain(env, { workspaceId: B, hostname: 'PORTAL.acme.example.', actorId: ownerB.id }))
      .rejects.toBeInstanceOf(DomainError);
    expect(await workspaceByHostname(env, 'portal.acme.example')).toEqual({ id: A, slug: 'acme-cd' });
  });

  it('a fresh pending claim blocks others; a stale unverified one is released', async () => {
    const { row } = await addDomain(env, { workspaceId: A, hostname: 'portal.acme.example', actorId: null });
    await expect(addDomain(env, { workspaceId: B, hostname: 'portal.acme.example', actorId: null }))
      .rejects.toMatchObject({ code: 'HOSTNAME_CLAIMED' });
    const old = new Date(Date.now() - STALE_CLAIM_MS - 1000).toISOString();
    await env.DB.prepare('UPDATE workspace_domains SET created_at = ? WHERE id = ?').bind(old, row.id).run();
    const { row: taken } = await addDomain(env, { workspaceId: B, hostname: 'portal.acme.example', actorId: null });
    expect(taken.workspace_id).toBe(B);
    expect(taken.verification_token).not.toBe(row.verification_token);
    expect(cf.calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/${row.provider_id}`))).toBe(true);
    // B still has to verify before anything routes.
    expect(taken.status).toBe('pending');
  });

  it('refresh is the only way to activate, and it needs the provider to confirm', async () => {
    const { row } = await addDomain(env, { workspaceId: A, hostname: 'portal.acme.example', actorId: null });
    expect((await refreshDomain(env, A, row.id)).status).toBe('pending');
    cf.activate('portal.acme.example');
    const done = await refreshDomain(env, A, row.id);
    expect(done.status).toBe('active');
    expect(done.verified_at).toBeTruthy();
    // Another workspace cannot refresh (or see) it.
    await expect(refreshDomain(env, B, row.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('login handoff', () => {
  it('signs in on the custom host through the apex, with a host-only cookie', async () => {
    await activeDomain(A, 'portal.acme.example');
    const login = await req('https://portal.acme.example/auth/login?redirect=/reports/');
    expect(login.status).toBe(302);
    const start = new URL(login.headers.get('Location')!);
    expect(start.origin).toBe('https://shareout.test');
    expect(start.pathname).toBe('/auth/handoff');
    expect(start.searchParams.get('host')).toBe('portal.acme.example');

    // Not signed in on the apex yet: sent to the apex login, which returns here.
    const anon = await req(start.toString());
    expect(anon.headers.get('Location')).toContain('/auth/login?redirect=%2Fauth%2Fhandoff');

    const minted = await req(start.toString(), { cookie: await cookieFor(owner) });
    const cb = new URL(minted.headers.get('Location')!);
    expect(cb.origin).toBe('https://portal.acme.example');
    expect(cb.pathname).toBe('/auth/handoff/callback');

    const done = await req(cb.toString());
    expect(done.status).toBe(302);
    expect(done.headers.get('Location')).toBe('/reports/');
    const setCookie = done.headers.get('Set-Cookie')!;
    expect(setCookie).toMatch(/^shareout_session=/);
    expect(setCookie).not.toMatch(/Domain=/i);

    // The new cookie is a working session on the custom host: the member lands home.
    const home = await req('https://portal.acme.example/', { cookie: setCookie.split(';')[0] });
    expect(home.headers.get('Location')).toBe(`/home?workspace=${A}`);

    // Single use.
    const replay = await req(cb.toString());
    expect(replay.status).toBe(400);
    expect(replay.headers.get('Set-Cookie')).toBeNull();
  });

  it('is bound to the hostname it was minted for', async () => {
    await activeDomain(A, 'portal.acme.example');
    await activeDomain(B, 'portal.globex.example');
    const code = await mintHandoffCode(env, 'portal.acme.example', owner.id, '/');
    const elsewhere = await req(`https://portal.globex.example/auth/handoff/callback?code=${code}`);
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.headers.get('Set-Cookie')).toBeNull();
    // Not spent by the wrong host: the right one still works.
    expect(await consumeHandoffCode(env, 'portal.acme.example', code)).toMatchObject({ userId: owner.id });
  });

  it('expires', async () => {
    const code = await mintHandoffCode(env, 'portal.acme.example', owner.id, '/');
    await env.DB.prepare('UPDATE workspace_domain_handoffs SET expires_at = ?').bind(new Date(Date.now() - 1000).toISOString()).run();
    expect(await consumeHandoffCode(env, 'portal.acme.example', code)).toBeNull();
  });

  it('never mints a code for a pending or unknown host, and never redirects off-site', async () => {
    await addDomain(env, { workspaceId: A, hostname: 'portal.acme.example', actorId: null });
    const cookie = await cookieFor(owner);
    for (const host of ['portal.acme.example', 'evil.example']) {
      const res = await req(`https://shareout.test/auth/handoff?host=${host}&redirect=/`, { cookie });
      expect(res.status).toBe(400);
    }
    expect(((await env.DB.prepare('SELECT COUNT(*) AS n FROM workspace_domain_handoffs').first<{ n: number }>())!).n).toBe(0);
    await activeDomain(B, 'portal.globex.example');
    const res = await req('https://shareout.test/auth/handoff?host=portal.globex.example&redirect=//evil.example/x', { cookie });
    const code = new URL(res.headers.get('Location')!).searchParams.get('code')!;
    expect(await consumeHandoffCode(env, 'portal.globex.example', code)).toMatchObject({ redirectPath: '/' });
  });
});

describe('links and emails use the primary domain', () => {
  it('artifact, publish and invite links switch to the primary custom domain', async () => {
    const base = 'https://shareout.test';
    expect(await workspaceArtifactUrl(env, base, 'acme-cd', 'q3-report')).toBe('https://acme-cd.shareout.test/q3-report/');
    const row = await activeDomain(A, 'portal.acme.example');
    // Active but not primary: still the subdomain.
    expect(await workspaceArtifactUrl(env, base, 'acme-cd', 'q3-report')).toBe('https://acme-cd.shareout.test/q3-report/');
    const set = await req(`${base}/v1/workspaces/${A}/domains/${row.id}`, { method: 'PATCH', body: JSON.stringify({ primary: true }), cookie: await cookieFor(owner) });
    expect(set.status).toBe(200);
    expect(await workspaceArtifactUrl(env, base, 'acme-cd', 'q3-report')).toBe('https://portal.acme.example/q3-report/');
    expect((await buildWorkspaceUrls(env, base, A, null, 'q3-report')).subdomainUrl).toBe('https://portal.acme.example/q3-report/');
    expect(await inviteLandingUrl(env, base, { user_id: member.id, workspace_id: A } as never)).toBe('https://portal.acme.example/home');
    // Other workspaces are unaffected.
    expect(await workspaceArtifactUrl(env, base, 'globex-cd', 'x')).toBe('https://globex-cd.shareout.test/x/');
  });
});

describe('host cache', () => {
  it('caches only active hostnames in KV, keyed by the full hostname', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    } as unknown as KVNamespace;
    const kvEnv = { ...env, SLUGS: kv } as Env;
    const { row } = await addDomain(kvEnv, { workspaceId: A, hostname: 'portal.acme.example', actorId: null });
    expect(await workspaceByHostname(kvEnv, 'portal.acme.example')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect([...store.keys()].filter((k) => k.startsWith('wshost:'))).toEqual([]);
    cf.activate('portal.acme.example');
    await refreshDomain(kvEnv, A, row.id);
    expect(await workspaceByHostname(kvEnv, 'portal.acme.example')).toEqual({ id: A, slug: 'acme-cd' });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.get('wshost:portal.acme.example')).toBe(`${A} acme-cd`);
  });
});
