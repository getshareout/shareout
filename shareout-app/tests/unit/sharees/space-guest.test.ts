// Space guests (no account) against the real migrated schema: a folder shared as a guest,
// the invite link and the email-code sign-in, the access layer (only the granted subtree,
// nothing else in the workspace), revocation on the next request, token binding and
// tampering, code rate limits, and commenting with the same verified identity.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as Array<{ type: string; toEmail?: string; data: Record<string, unknown> }>);
vi.mock('../../../src/email/gateway', () => ({
  dispatchLifecycleEmail: vi.fn(async (_env: unknown, input: { type: string; toEmail?: string; data: Record<string, unknown> }) => {
    sent.push(input);
    return { sent: true };
  }),
}));

import worker from '../../../src/index';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';
import type { ArtifactInfo } from '../../../src/serve/types';
import { handleShareWithPerson, handleDeleteGrant } from '../../../src/sharees/grants';
import {
  handleSpaceGuestAccept, handleSpaceGuestCode, handleSpaceGuestVerify, resolveSpaceGuests,
  signSpaceGuestToken, spaceGuestCookieName, mintSpaceGuestAccessToken, spaceGuestFromGrant,
} from '../../../src/sharees/space-guest';
import { handleSpaceGuestPortal, renderSpaceGuestSignIn } from '../../../src/sharees/space-guest-page';
import { hashGuestEmail, signGuestToken } from '../../../src/data/comments/guest';
import { checkAccess } from '../../../src/serve/access';
import { dataMiddleware, type DataContext } from '../../../src/data/middleware';
import { handleDataRequest, spaceGuestTierAllowed } from '../../../src/data/router';
import { handleComments } from '../../../src/data/comments';
import { handleListFolderActivity } from '../../../src/sharees/activity';
import { queryFolderAccess } from '../../../src/pages/home/queries/folders';

const SECRET = 'space-guest-secret';
const ORIGIN = 'https://shareout.test';
const doStub = { idFromName: () => 'x', get: () => ({ fetch: async () => new Response('ok') }) };
const env = { ...baseEnv, SESSION_SECRET: SECRET, COMMENTS: doStub } as unknown as Env;
const WS = 'wsp_sg';
const WS2 = 'wsp_sg2';
const admin = { id: 'usr_sg_admin', email: 'admin@studio.test', username: null } as AuthUser;
const member = { id: 'usr_sg_member', email: 'member@studio.test', username: null } as AuthUser;
const GUEST = 'dana@client.test';
const OTHER = 'eve@client.test';
const A = { inSub: 'art_sg_in', other: 'art_sg_other', ws2: 'art_sg_ws2', pw: 'art_sg_pw', pub: 'art_sg_pub' };

let ip = 0;
const nextIp = () => `10.9.${Math.floor(++ip / 250)}.${ip % 250}`;
const share = (body: Record<string, unknown>) => handleShareWithPerson(new Request(`${ORIGIN}/x`, {
  method: 'POST', body: JSON.stringify({ resource_type: 'folder', resource_id: 'fld_sg_space', email: GUEST, capability: 'comment', guest: true, ...body }),
}), env, admin, WS);
const grantId = async (email = GUEST, folder = 'fld_sg_space') => (await env.DB.prepare(
  "SELECT id FROM grants WHERE subject_type = 'guest' AND subject_id = ? AND resource_id = ?",
).bind(email, folder).first<{ id: string }>())!.id;
const info = (id: string, over: Partial<ArtifactInfo> = {}) => ({
  artifact_id: id, visibility: 'private', auth_method: 'google', owner_id: admin.id, workspace_id: WS, ...over,
} as ArtifactInfo);
const view = (id: string, cookie: string, over: Partial<ArtifactInfo> = {}) =>
  checkAccess(new Request(`${ORIGIN}/a/${id}/`, { headers: { Cookie: cookie } }), env, id, info(id, over));

/** Accept the newest invite link and return the cookie pair it sets. */
async function acceptInvite(): Promise<string> {
  const inv = [...sent].reverse().find((m) => m.type === 'space_guest_invite')!;
  const res = await handleSpaceGuestAccept(new Request(String(inv.data.url)), env);
  return res.headers.get('Set-Cookie')!.split(';')[0];
}
async function sessionFor(email = GUEST, folder = 'fld_sg_space', capability = 'comment'): Promise<string> {
  await share({ email, resource_id: folder, capability });
  return acceptInvite();
}
const post = (path: string, body: unknown, origin: string | null = ORIGIN, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': nextIp(), ...(origin ? { Origin: origin } : {}), ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?)').bind(admin.id, admin.email, 'Ada', member.id, member.email, 'Max'),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Studio', 'studio-sg', ?), (?, 'Elsewhere', 'elsewhere-sg', ?)").bind(WS, admin.id, WS2, admin.id),
    env.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_sg1', ?, ?, 'admin', 'internal'), ('wm_sg2', ?, ?, 'member', 'internal'), ('wm_sg3', ?, ?, 'admin', 'internal')")
      .bind(WS, admin.id, WS, member.id, WS2, admin.id),
    env.DB.prepare(`INSERT INTO folders (id, workspace_id, name, slug, parent_id, visibility, created_by) VALUES
      ('fld_sg_space', ?, 'Client space', 'space', NULL, 'private', ?),
      ('fld_sg_sub', ?, 'Drafts', 'drafts', 'fld_sg_space', 'inherit', ?),
      ('fld_sg_other', ?, 'Board', 'board', NULL, 'private', ?),
      ('fld_sg_ws2', ?, 'Theirs', 'theirs', NULL, 'private', ?)`).bind(WS, admin.id, WS, admin.id, WS, admin.id, WS2, admin.id),
    env.DB.prepare(`INSERT INTO artifacts (id, workspace_id, folder_id, owner_id, name, slug, visibility, auth_method) VALUES
      ('${A.inSub}', ?, 'fld_sg_sub', ?, 'Proposal', 'sg-proposal', 'private', 'google'),
      ('${A.other}', ?, 'fld_sg_other', ?, 'Board deck', 'sg-board', 'private', 'google'),
      ('${A.ws2}', ?, 'fld_sg_ws2', ?, 'Their deck', 'sg-theirs', 'private', 'google'),
      ('${A.pw}', ?, 'fld_sg_space', ?, 'Locked', 'sg-locked', 'private', 'password'),
      ('${A.pub}', ?, 'fld_sg_space', ?, 'Public note', 'sg-public', 'public', NULL)`)
      .bind(WS, admin.id, WS, admin.id, WS2, admin.id, WS, admin.id, WS, admin.id),
  ]);
});

beforeEach(async () => {
  sent.length = 0;
  await env.DB.exec("DELETE FROM grants WHERE subject_type = 'guest'");
  await env.DB.exec("DELETE FROM email_otp_codes WHERE email LIKE 'sguest:%'");
});

describe('sharing a folder as a guest', () => {
  it('mints a guest grant and emails a link — no user row, no membership', async () => {
    const res = await share({});
    expect(res.status).toBe(201);
    const body = await res.json() as { grant: { subject_type: string; subject_id: string }; guest: boolean };
    expect(body.guest).toBe(true);
    expect(body.grant).toMatchObject({ subject_type: 'guest', subject_id: GUEST });
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(GUEST).first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE u.email = ?").bind(GUEST).first()).toBeNull();
    const inv = sent.find((m) => m.type === 'space_guest_invite')!;
    expect(inv.toEmail).toBe(GUEST);
    expect(String(inv.data.url)).toContain('/shared/guest/accept?t=');
  });

  it('refuses files, internal members, and shows the guest in the access panel', async () => {
    expect((await share({ resource_type: 'file', resource_id: 'dlv_x' })).status).toBe(400);
    expect((await share({ email: member.email })).status).toBe(409);
    await share({});
    const fa = await queryFolderAccess(env, WS, 'fld_sg_space');
    expect(fa!.grants).toEqual([expect.objectContaining({ subject_type: 'guest', subject_label: GUEST, capability: 'comment' })]);
  });
});

describe('the invite link', () => {
  it('sets an HttpOnly, Secure, SameSite=Lax session cookie and lands on the portal', async () => {
    await share({});
    const inv = sent.find((m) => m.type === 'space_guest_invite')!;
    const res = await handleSpaceGuestAccept(new Request(String(inv.data.url)), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${ORIGIN}/shared?folder=fld_sg_space`);
    const c = res.headers.get('Set-Cookie')!;
    expect(c).toMatch(/^shareout_sg_grt_[0-9a-f]+=/);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/;');
  });

  it('a tampered link sets nothing and falls back to the code page', async () => {
    await share({});
    const url = new URL(String(sent.find((m) => m.type === 'space_guest_invite')!.data.url));
    const t = url.searchParams.get('t')!;
    url.searchParams.set('t', t.slice(0, -2) + (t.endsWith('A') ? 'BB' : 'AA'));
    const res = await handleSpaceGuestAccept(new Request(url.toString()), env);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Location')).toContain('link=expired');
  });
});

describe('access layer', () => {
  it('views only the granted folder subtree', async () => {
    const cookie = await sessionFor();
    expect(await view(A.inSub, cookie)).toBeNull();
    const portal = await handleSpaceGuestPortal(new Request(`${ORIGIN}/shared?folder=fld_sg_space`, { headers: { Cookie: cookie } }), env, 'fld_sg_space');
    const html = await portal!.text();
    expect(html).toContain('Proposal');
    expect(html).toContain('Studio');
    expect(html).not.toContain('Board deck');
    expect(await handleSpaceGuestPortal(new Request(ORIGIN, { headers: { Cookie: cookie } }), env, 'fld_sg_sub')).not.toBeNull();
  });

  it('renders the folder name as text in the page title', async () => {
    const cookie = await sessionFor();
    await env.DB.prepare("UPDATE folders SET name = ? WHERE id = 'fld_sg_space'").bind('</title><script>x()</script>').run();
    try {
      const portal = await handleSpaceGuestPortal(new Request(`${ORIGIN}/shared?folder=fld_sg_space`, { headers: { Cookie: cookie } }), env, 'fld_sg_space');
      const html = await portal!.text();
      expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;</title>');
      expect(html).not.toContain('<script>x()</script>');
    } finally {
      await env.DB.prepare("UPDATE folders SET name = 'Client space' WHERE id = 'fld_sg_space'").run();
    }
  });

  it('is denied for another folder in the same workspace, another workspace, and a password page', async () => {
    const cookie = await sessionFor();
    expect(await view(A.other, cookie)).not.toBeNull();
    expect(await view(A.ws2, cookie, { workspace_id: WS2 })).not.toBeNull();
    expect(await view(A.pw, cookie, { auth_method: 'password' })).not.toBeNull();
    const req = new Request(ORIGIN, { headers: { Cookie: cookie } });
    expect(await handleSpaceGuestPortal(req, env, 'fld_sg_other')).toBeNull();
    expect(await handleSpaceGuestPortal(req, env, 'fld_sg_ws2')).toBeNull();
  });

  it('shows the same neutral sign-in card for any folder id (no oracle)', async () => {
    const a = await renderSpaceGuestSignIn(new Request(`${ORIGIN}/shared?folder=fld_sg_space`), 'fld_sg_space').text();
    const b = await renderSpaceGuestSignIn(new Request(`${ORIGIN}/shared?folder=fld_nope`), 'fld_nope').text();
    expect(a.replace(/fld_sg_space/g, 'X')).toBe(b.replace(/fld_nope/g, 'X'));
    expect(a).not.toContain('Client space');
  });

  it('lists the guest in "who opened what"', async () => {
    const cookie = await sessionFor();
    await env.DB.exec("DELETE FROM audit_log WHERE action = 'space_guest.view'");
    await env.SLUGS.delete(`sgactivity:${await grantId()}:artifact:${A.inSub}`);
    expect(await view(A.inSub, cookie)).toBeNull();
    const res = await handleListFolderActivity(env, admin, WS, 'fld_sg_space');
    const { activity } = await res.json() as { activity: Array<Record<string, unknown>> };
    expect(activity).toEqual(expect.arrayContaining([expect.objectContaining({ user_email: GUEST, resource_name: 'Proposal', action: 'view', guest: 1 })]));
  });
});

describe('revocation', () => {
  it('a revoked grant kills the session on the next request', async () => {
    const cookie = await sessionFor();
    expect(await view(A.inSub, cookie)).toBeNull();
    const del = await handleDeleteGrant(new Request(ORIGIN, { method: 'DELETE' }), env, admin, WS, await grantId());
    expect(del.status).toBe(200);
    expect(await view(A.inSub, cookie)).not.toBeNull();
    expect(await resolveSpaceGuests(new Request(ORIGIN, { headers: { Cookie: cookie } }), env)).toEqual([]);
  });

  it('an expired grant is denied, also once time passes the stored expiry', async () => {
    const cookie = await sessionFor();
    await env.DB.prepare('UPDATE grants SET expires_at = ? WHERE id = ?').bind(new Date(Date.now() + 3_600_000).toISOString(), await grantId()).run();
    expect(await view(A.inSub, cookie)).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 2 * 3_600_000);
      expect(await view(A.inSub, cookie)).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('a deleted folder ends the session', async () => {
    await env.DB.exec("INSERT INTO folders (id, workspace_id, name, slug, created_by) VALUES ('fld_sg_tmp', 'wsp_sg', 'Temp', 'tmp', 'usr_sg_admin')");
    await env.DB.exec("INSERT INTO artifacts (id, workspace_id, folder_id, owner_id, name, slug, visibility, auth_method) VALUES ('art_sg_tmp', 'wsp_sg', 'fld_sg_tmp', 'usr_sg_admin', 'Temp', 'sg-tmp', 'private', 'google')");
    const cookie = await sessionFor(GUEST, 'fld_sg_tmp');
    expect(await view('art_sg_tmp', cookie)).toBeNull();
    await env.DB.exec("UPDATE artifacts SET folder_id = NULL WHERE id = 'art_sg_tmp'");
    await env.DB.exec("DELETE FROM folders WHERE id = 'fld_sg_tmp'");
    expect(await view('art_sg_tmp', cookie)).not.toBeNull();
  });

  it('the page token re-checks the grant on every data call', async () => {
    await share({});
    const guest = (await spaceGuestFromGrant(env, await grantId()))!;
    const token = await mintSpaceGuestAccessToken(env, A.inSub, guest);
    const call = () => dataMiddleware(new Request(`${ORIGIN}/v1/data/${A.inSub}/json`, { headers: { Authorization: `Bearer ${token}` } }), env, A.inSub);
    const ctx = await call() as DataContext;
    expect(ctx.spaceGuest?.grantId).toBe(guest.grantId);
    expect(ctx.canWrite).toBe(false);
    await handleDeleteGrant(new Request(ORIGIN, { method: 'DELETE' }), env, admin, WS, guest.grantId);
    expect(await call()).toBeInstanceOf(Response);
  });
});

describe('token binding and tampering', () => {
  it('a token bound to one space cannot be used for another', async () => {
    const mine = await sessionFor();
    await share({ email: OTHER, resource_id: 'fld_sg_other', capability: 'view' });
    const otherGrant = await grantId(OTHER, 'fld_sg_other');
    const token = mine.split('=').slice(1).join('=');
    // My valid token under the other grant's cookie name.
    expect(await view(A.other, `${spaceGuestCookieName(otherGrant)}=${token}`)).not.toBeNull();
    // Signed with the real secret but pointing at the other grant: folder and email hash do not match.
    const forged = await signSpaceGuestToken(SECRET, { w: WS, g: otherGrant, f: 'fld_sg_space', h: await hashGuestEmail(SECRET, GUEST), n: 'x' });
    expect(await view(A.other, `${spaceGuestCookieName(otherGrant)}=${forged}`)).not.toBeNull();
    const wrongEmail = await signSpaceGuestToken(SECRET, { w: WS, g: otherGrant, f: 'fld_sg_other', h: await hashGuestEmail(SECRET, GUEST), n: 'x' });
    expect(await view(A.other, `${spaceGuestCookieName(otherGrant)}=${wrongEmail}`)).not.toBeNull();
  });

  it('rejects forged, tampered, expired and foreign tokens', async () => {
    await share({});
    const g = await grantId();
    const name = spaceGuestCookieName(g);
    const claims = { w: WS, g, f: 'fld_sg_space', h: await hashGuestEmail(SECRET, GUEST), n: 'Dana' };
    const good = await signSpaceGuestToken(SECRET, claims);
    expect(await view(A.inSub, `${name}=${good}`)).toBeNull();
    const [data, sig] = good.split('.');
    const flipped = data.slice(0, -1) + (data.endsWith('A') ? 'B' : 'A');
    expect(await view(A.inSub, `${name}=${flipped}.${sig}`)).not.toBeNull();
    expect(await view(A.inSub, `${name}=${await signSpaceGuestToken('wrong-secret', claims)}`)).not.toBeNull();
    expect(await view(A.inSub, `${name}=${await signSpaceGuestToken(SECRET, claims, -10)}`)).not.toBeNull();
    expect(await view(A.inSub, `${name}=${await signGuestToken(SECRET, A.inSub, 'Dana', claims.h)}`)).not.toBeNull();
    expect(await view(A.inSub, `${name}=${good}.extra`)).not.toBeNull();
  });
});

describe('nothing else in the workspace', () => {
  it('no /home, search, members, the agent or MCP', async () => {
    const cookie = await sessionFor();
    const go = (path: string, init: RequestInit = {}) =>
      worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers: { Cookie: cookie, ...(init.headers || {}) } }), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    const home = await go('/home');
    expect(home.status).toBe(302);
    expect(home.headers.get('Location')).toContain('/auth/login');
    expect((await go('/v1/search?q=proposal')).status).toBe(401);
    expect((await go(`/v1/workspaces/${WS}/members`)).status).toBe(401);
    expect((await go('/v1/home/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: '{}' })).status).toBeGreaterThanOrEqual(400);
    expect((await go('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })).status).toBe(401);
  });

  it('the data API refuses the agent and every non-viewer tier, and the people list', async () => {
    const cookie = await sessionFor();
    const res = await handleDataRequest(new Request(`${ORIGIN}/v1/data/${A.inSub}/agent/chat`, {
      method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}',
    }), env, `/${A.inSub}/agent/chat`);
    expect(res.status).toBe(403);
    for (const [tier, m] of [['agent', 'GET'], ['crew', 'GET'], ['workspace', 'GET'], ['secrets', 'GET'], ['email', 'POST'], ['provision', 'POST'], ['realtime', 'GET'], ['proxy', 'GET'], ['json', 'PUT']]) {
      expect(spaceGuestTierAllowed(tier, m, '/x')).toBe(false);
    }
    expect(spaceGuestTierAllowed('json', 'GET', '/x')).toBe(true);
    expect(spaceGuestTierAllowed('connections', 'POST', '/sales/query')).toBe(true);
    const ctx = await dataMiddleware(new Request(`${ORIGIN}/v1/data/${A.inSub}/comments/_people`, { headers: { Cookie: cookie } }), env, A.inSub) as DataContext;
    expect((await handleComments(new Request(`${ORIGIN}/v1/data/${A.inSub}/comments/_people`, { headers: { Cookie: cookie } }), ctx, '/_people')).status).toBe(401);
  });

  it('anonymous without a session is still refused by the data API', async () => {
    const res = await dataMiddleware(new Request(`${ORIGIN}/v1/data/${A.inSub}/json`), env, A.inSub);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });
});

describe('email code sign-in', () => {
  const codeOf = () => String([...sent].reverse().find((m) => m.type === 'space_guest_code')!.data.code);

  it('answers the same for an ungranted email and sends nothing', async () => {
    await share({});
    const res = await handleSpaceGuestCode(post('/shared/guest/code', { folder: 'fld_sg_space', email: 'stranger@x.test' }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { sent: true } });
    expect(sent.some((m) => m.type === 'space_guest_code')).toBe(false);
  });

  it('a granted email (from a subfolder link) gets a code; the right code mints the session', async () => {
    await share({});
    expect((await handleSpaceGuestCode(post('/shared/guest/code', { folder: 'fld_sg_sub', email: GUEST }), env)).status).toBe(200);
    const res = await handleSpaceGuestVerify(post('/shared/guest/verify', { folder: 'fld_sg_sub', email: GUEST, code: codeOf(), name: 'Dana Client' }), env);
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie')!.split(';')[0];
    expect(await view(A.inSub, cookie)).toBeNull();
    const [g] = await resolveSpaceGuests(new Request(ORIGIN, { headers: { Cookie: cookie } }), env);
    expect(g.name).toBe('Dana Client');
  });

  it('refuses a foreign Origin', async () => {
    expect((await handleSpaceGuestCode(post('/shared/guest/code', { folder: 'fld_sg_space', email: GUEST }, 'https://evil.test'), env)).status).toBe(403);
    expect((await handleSpaceGuestVerify(post('/shared/guest/verify', { folder: 'fld_sg_space', email: GUEST, code: '000000' }, null), env)).status).toBe(403);
  });

  it('rate limits: resend window, per-address hourly cap, and attempts per code', async () => {
    await share({});
    const ask = () => handleSpaceGuestCode(post('/shared/guest/code', { folder: 'fld_sg_space', email: GUEST }), env);
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
    const good = codeOf();
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await handleSpaceGuestVerify(post('/shared/guest/verify', { folder: 'fld_sg_space', email: GUEST, code: bad }), env)).status).toBe(400);
    }
    expect((await handleSpaceGuestVerify(post('/shared/guest/verify', { folder: 'fld_sg_space', email: GUEST, code: good }), env)).status).toBe(400);
    const key = `sguest:${await hashGuestEmail(SECRET, GUEST)}`;
    const old = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < 6; i++) {
      await env.DB.prepare("INSERT INTO email_otp_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, 'x', ?, ?)").bind(`otp_sg_${i}`, key, old, old).run();
    }
    await env.DB.exec(`UPDATE email_otp_codes SET created_at = '${old}' WHERE email = '${key}'`);
    const capped = await ask();
    expect(capped.status).toBe(429);
    expect(((await capped.json()) as { error: string }).error).toContain('Too many codes');
  });

  it('an unknown folder or a revoked grant never verifies', async () => {
    await share({});
    await handleSpaceGuestCode(post('/shared/guest/code', { folder: 'fld_sg_space', email: GUEST }), env);
    const code = codeOf();
    await handleDeleteGrant(new Request(ORIGIN, { method: 'DELETE' }), env, admin, WS, await grantId());
    expect((await handleSpaceGuestVerify(post('/shared/guest/verify', { folder: 'fld_sg_space', email: GUEST, code }), env)).status).toBe(400);
  });
});

describe('comments with the same verified identity', () => {
  const configs = new Map<string, unknown>();
  const store = (id: string) => ({
    prepare: () => ({ bind: () => ({ first: async () => (configs.get(id) ? { value: JSON.stringify(configs.get(id)) } : null), run: async () => ({ meta: { changes: 1 } }) }) }),
  });
  async function ctxFor(id: string, req: Request): Promise<DataContext> {
    const ctx = await dataMiddleware(req, env, id);
    if (ctx instanceof Response) throw new Error(`middleware ${ctx.status}`);
    return { ...ctx, db: store(id) as unknown as DataContext['db'] };
  }
  const req = (id: string, path: string, cookie: string, init: { method?: string; body?: unknown; origin?: string | null } = {}) =>
    new Request(`${ORIGIN}/v1/data/${id}/comments${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'cf-connecting-ip': nextIp(), ...(init.origin === null ? {} : { Origin: init.origin ?? ORIGIN }) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  beforeEach(() => { configs.clear(); configs.set(A.inSub, { identityMode: 'authenticated' }); });

  it('a comment grant posts as the space guest, with no second code', async () => {
    const cookie = await sessionFor();
    const status = await handleComments(req(A.inSub, '/_guest', cookie), await ctxFor(A.inSub, req(A.inSub, '/_guest', cookie)), '/_guest');
    expect(((await status.json()) as { data: unknown }).data).toMatchObject({ enabled: true, guest: { name: 'dana' } });
    const r = req(A.inSub, '', cookie, { method: 'POST', body: { content: 'Looks good' } });
    const res = await handleComments(r, await ctxFor(A.inSub, r.clone()), '');
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT author_type, author_name, author_id, guest_email_hash FROM artifact_comments WHERE artifact_id = ? AND content = 'Looks good'")
      .bind(A.inSub).first<Record<string, unknown>>();
    expect(row).toEqual({ author_type: 'guest', author_name: 'dana', author_id: null, guest_email_hash: await hashGuestEmail(SECRET, GUEST) });
  });

  it('a view-only guest reads but cannot post', async () => {
    const cookie = await sessionFor(GUEST, 'fld_sg_space', 'view');
    const list = req(A.inSub, '', cookie);
    expect((await handleComments(list, await ctxFor(A.inSub, list.clone()), '')).status).toBe(200);
    const r = req(A.inSub, '', cookie, { method: 'POST', body: { content: 'nope' } });
    expect((await handleComments(r, await ctxFor(A.inSub, r.clone()), '')).status).toBe(403);
  });

  it('a cookie write from another origin is not the guest', async () => {
    const cookie = await sessionFor();
    const r = req(A.inSub, '', cookie, { method: 'POST', body: { content: 'csrf' }, origin: 'https://evil.test' });
    expect(await dataMiddleware(r, env, A.inSub)).toBeInstanceOf(Response);
  });
});
