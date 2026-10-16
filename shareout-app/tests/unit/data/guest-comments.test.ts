// Guest comments (no account) against the real migrated schema: the owner turns them on,
// a guest proves an email with a code, gets an artifact-bound cookie and comments. Every
// line of the security bar has a case here: enabled AND viewable, token bound to one
// artifact, no guest reads another guest's email, CSRF (Origin), rate limits, and no
// resolve / assign / react for guests, while the owner can delete their comments.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const notify = vi.hoisted(() => vi.fn());
vi.mock('../../../src/data/comment-notify', () => ({
  dispatchCommentNotify: (...a: unknown[]) => notify(...a),
  dispatchActionItemResolved: vi.fn(),
}));

import { handleComments } from '../../../src/data/comments';
import { signGuestToken, hashGuestEmail, guestCookieName } from '../../../src/data/comments/guest';
import { handleFolderGuestComments } from '../../../src/sharees/folder-guest-comments';
import type { DataContext } from '../../../src/data/middleware';
import type { AuthUser } from '../../../src/api-auth';
import { createAccessToken, createSessionToken } from '../../../src/token';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';

const SECRET = 'guest-test-secret';
const ORIGIN = 'https://shareout.test';
const WS = 'ws_gc';
const owner = { id: 'usr_gc_owner', email: 'owner@example.com' };
const member = { id: 'usr_gc_member', email: 'member@example.com' };
const A = { pub: 'art_gc_pub', pub2: 'art_gc_pub2', priv: 'art_gc_priv', pw: 'art_gc_pw', inFolder: 'art_gc_folder', optOut: 'art_gc_optout' };

const doStub = { idFromName: () => 'x', get: () => ({ fetch: async () => new Response('ok') }) };
const env = { ...baseEnv, SESSION_SECRET: SECRET, EMAIL: undefined, COMMENTS: doStub } as unknown as typeof baseEnv;

type Cfg = Record<string, unknown> | null;
const configs = new Map<string, Cfg>();

/** In-memory stand-in for the per-artifact mini-store (only `_comments_config` is used). */
function miniStore(artifactId: string) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              const cfg = configs.get(artifactId);
              if (!cfg) return null;
              return sql.includes('SELECT id') ? { id: 'jsn_1' } : { value: JSON.stringify(cfg) };
            },
            async run() {
              if (sql.startsWith('UPDATE')) configs.set(artifactId, JSON.parse(String(args[0])));
              if (sql.startsWith('INSERT')) configs.set(artifactId, JSON.parse(String(args[3])));
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

const ARTS: Record<string, { visibility: string; auth_method: string | null }> = {
  [A.pub]: { visibility: 'public', auth_method: null },
  [A.pub2]: { visibility: 'public', auth_method: null },
  [A.priv]: { visibility: 'private', auth_method: 'google' },
  [A.pw]: { visibility: 'private', auth_method: 'password' },
  [A.inFolder]: { visibility: 'public', auth_method: null },
  [A.optOut]: { visibility: 'public', auth_method: null },
};

function ctx(artifactId: string): DataContext {
  const a = ARTS[artifactId];
  return {
    artifactId, workspaceId: WS, env,
    db: miniStore(artifactId) as unknown as DataContext['db'],
    artifact: { id: artifactId, name: 'Proposal', visibility: a.visibility, auth_method: a.auth_method, workspace_id: WS, owner_id: owner.id },
    origin: ORIGIN,
  } as DataContext;
}

let ipSeq = 0;
function req(artifactId: string, path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string; auth?: string } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'cf-connecting-ip': init.ip ?? `10.0.0.${++ipSeq % 250}` };
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.auth) headers.Authorization = init.auth;
  return new Request(`${ORIGIN}/v1/data/${artifactId}/comments${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}
const call = (artifactId: string, path: string, init: Parameters<typeof req>[2] = {}) =>
  handleComments(req(artifactId, path, init), ctx(artifactId), path);

async function guestCookie(artifactId: string, name = 'Dana Client', email = 'dana@client.test'): Promise<string> {
  const h = await hashGuestEmail(SECRET, email);
  return `${guestCookieName(artifactId)}=${await signGuestToken(SECRET, artifactId, name, h)}`;
}

/** Runs the real code → verify flow and returns the Set-Cookie value. */
async function signInGuest(artifactId: string, email: string, name = 'Dana Client', extraCookie = ''): Promise<{ cookie: string; setCookie: string }> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const sent = await call(artifactId, '/_guest/code', { method: 'POST', body: { name, email }, cookie: extraCookie || undefined });
  expect(sent.status).toBe(200);
  const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes(`code for ${email}`))!;
  log.mockRestore();
  const code = line.trim().slice(-6);
  const res = await call(artifactId, '/_guest/verify', { method: 'POST', body: { name, email, code }, cookie: extraCookie || undefined });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('Set-Cookie')!;
  return { cookie: setCookie.split(';')[0], setCookie };
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?)').bind(owner.id, owner.email, 'Olivia', member.id, member.email, 'Mike'),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Studio', 'studio-gc', ?)").bind(WS, owner.id),
    env.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_gc1', ?, ?, 'owner', 'internal'), ('wm_gc2', ?, ?, 'member', 'internal')").bind(WS, owner.id, WS, member.id),
    env.DB.prepare("INSERT INTO folders (id, workspace_id, owner_id, name, slug, created_by, guest_comments_enabled) VALUES ('fld_gc', ?, ?, 'Client review', 'client-review', ?, 1)").bind(WS, owner.id, owner.id),
    ...Object.entries(ARTS).map(([id, a]) => env.DB.prepare(
      'INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, auth_method, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, 'Proposal', `slug-${id}`, owner.id, WS, a.visibility, a.auth_method, id === A.inFolder || id === A.optOut ? 'fld_gc' : null)),
  ]);
});

beforeEach(() => {
  notify.mockClear();
  configs.clear();
  for (const id of [A.pub, A.pub2, A.priv, A.pw]) configs.set(id, { identityMode: 'named', guestComments: true });
  configs.set(A.optOut, { identityMode: 'named', guestComments: false });
});
afterEach(() => vi.restoreAllMocks());

describe('turning guests on', () => {
  it('is off by default: no code is sent and an unverified commenter cannot use the guest path', async () => {
    configs.set(A.pub, { identityMode: 'authenticated' });
    const res = await call(A.pub, '/_guest/code', { method: 'POST', body: { name: 'X', email: 'x@client.test' } });
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('GUEST_COMMENTS_DISABLED');
    const post = await call(A.pub, '', { method: 'POST', body: { content: 'hi' }, cookie: await guestCookie(A.pub) });
    expect(post.status).toBe(401);
  });

  it('only the owner may switch it, and the folder setting reaches artifacts without their own', async () => {
    const memberCookie = `shareout_session=${await createSessionToken(member.id, member.email, env)}`;
    const denied = await call(A.pub, '/_config', { method: 'PUT', body: { guestComments: false }, cookie: memberCookie });
    expect(denied.status).toBe(403);
    const ownerCookie = `shareout_session=${await createSessionToken(owner.id, owner.email, env)}`;
    const bad = await call(A.pub, '/_config', { method: 'PUT', body: { guestComments: 'yes' }, cookie: ownerCookie });
    expect(bad.status).toBe(400);
    const okRes = await call(A.pub, '/_config', { method: 'PUT', body: { guestComments: false }, cookie: ownerCookie });
    expect(await okRes.json()).toMatchObject({ data: { guestComments: false, guestCommentsEffective: false } });

    const inherited = await call(A.inFolder, '/_guest');
    expect(await inherited.json()).toMatchObject({ data: { enabled: true, guest: null } });
    const override = await call(A.optOut, '/_guest');
    expect(await override.json()).toMatchObject({ data: { enabled: false } });
  });

  it('the folder switch needs the folder manager', async () => {
    const put = (u: { id: string; email: string }, enabled: unknown) => handleFolderGuestComments(
      new Request(`${ORIGIN}/x`, { method: 'PUT', body: JSON.stringify({ enabled }) }), env, { ...u, username: null } as AuthUser, WS, 'fld_gc');
    // Members may not manage a folder someone else created unless the workspace lets them.
    expect((await put(member, false)).status).toBe(403);
    expect((await put(owner, 'no')).status).toBe(400);
    const res = await put(owner, true);
    expect(await res.json()).toMatchObject({ folder_id: 'fld_gc', guest_comments: true });
  });
});

describe('who may get a guest token', () => {
  it('a public artifact: code → verify sets an HttpOnly, SameSite=Strict cookie bound to the artifact', async () => {
    const { setCookie } = await signInGuest(A.pub, 'dana@client.test');
    expect(setCookie).toMatch(new RegExp(`^${guestCookieName(A.pub)}=`));
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Max-Age=43200');
  });

  it('a private artifact (account sign-in) never lets a guest in, even with guests on', async () => {
    const res = await call(A.priv, '/_guest/code', { method: 'POST', body: { name: 'X', email: 'x@client.test' } });
    expect(res.status).toBe(403);
    // Even a validly signed token is ignored: the request falls back to the named-mode
    // rules (in production the data router has already refused it with 401).
    const post = await call(A.priv, '', { method: 'POST', body: { content: 'hi' }, cookie: await guestCookie(A.priv) });
    expect(await post.json()).toMatchObject({ code: 'NAME_REQUIRED' });
  });

  it('a password artifact needs the unlocked access cookie (the share link proof)', async () => {
    const locked = await call(A.pw, '/_guest/code', { method: 'POST', body: { name: 'X', email: 'x@client.test' } });
    expect(locked.status).toBe(403);
    const access = `shareout_access_${A.pw}=${await createAccessToken(A.pw, 'password', env)}`;
    const wrongArtifact = `shareout_access_${A.pw}=${await createAccessToken(A.pub, 'password', env)}`;
    const forged = await call(A.pw, '/_guest/code', { method: 'POST', body: { name: 'X', email: 'y@client.test' }, cookie: wrongArtifact });
    expect(forged.status).toBe(403);
    const { cookie } = await signInGuest(A.pw, 'pw@client.test', 'Pat', access);
    const post = await call(A.pw, '', { method: 'POST', body: { content: 'Looks good' }, cookie: `${cookie}; ${access}` });
    expect(post.status).toBe(201);
    const noAccess = await call(A.pw, '', { method: 'POST', body: { content: 'again' }, cookie });
    expect(noAccess.status).not.toBe(201);
  });

  it('a wrong code fails, and five misses burn the code', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await call(A.pub, '/_guest/code', { method: 'POST', body: { name: 'Q', email: 'q@client.test' } });
    const code = String(log.mock.calls.at(-1)![0]).trim().slice(-6);
    log.mockRestore();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await call(A.pub, '/_guest/verify', { method: 'POST', body: { name: 'Q', email: 'q@client.test', code: wrong } });
      expect(r.status).toBe(400);
    }
    const late = await call(A.pub, '/_guest/verify', { method: 'POST', body: { name: 'Q', email: 'q@client.test', code } });
    expect(late.status).toBe(400);
  });
});

describe('guest comments', () => {
  it('posts as author_type guest with only a keyed email hash stored, and the status shows only the name', async () => {
    const { cookie } = await signInGuest(A.pub, 'dana@client.test'.replace('dana', 'dana2'));
    const res = await call(A.pub, '', { method: 'POST', body: { content: 'Can we move the CTA up? @mike', mentions: [member.email], authorName: 'Spoofed' }, cookie });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ authorName: 'Dana Client', authorType: 'guest', authorId: null, mentions: [] });
    const row = await env.DB.prepare('SELECT * FROM artifact_comments WHERE id = ?').bind(body.data.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ author_type: 'guest', guest_email_hash: await hashGuestEmail(SECRET, 'dana2@client.test') });
    expect(JSON.stringify(row)).not.toContain('dana2@client.test');
    expect(notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ authorType: 'guest' }));

    const status = await call(A.pub, '/_guest', { cookie });
    expect(await status.json()).toEqual({ success: true, data: { enabled: true, guest: { name: 'Dana Client' } } });
  });

  it('no reader sees any guest email or hash in the comment list', async () => {
    const a = await signInGuest(A.pub, 'ann@client.test', 'Ann');
    const b = await signInGuest(A.pub, 'ben@client.test', 'Ben');
    await call(A.pub, '', { method: 'POST', body: { content: 'from ann' }, cookie: a.cookie });
    await call(A.pub, '', { method: 'POST', body: { content: 'from ben' }, cookie: b.cookie });
    const list = await (await call(A.pub, '', { cookie: a.cookie })).text();
    expect(list).toContain('from ben');
    expect(list).not.toMatch(/ben@client\.test|ann@client\.test/);
    expect(list).not.toContain(await hashGuestEmail(SECRET, 'ben@client.test'));
    expect(list).not.toContain('guest_email');
  });

  it('a token is bound to one artifact', async () => {
    const forPub = await guestCookie(A.pub);
    const reused = forPub.replace(guestCookieName(A.pub), guestCookieName(A.pub2));
    const res = await call(A.pub2, '', { method: 'POST', body: { content: 'x' }, cookie: reused });
    expect(res.status).toBe(401);
    expect((await res.json() as { code: string }).code).toBe('GUEST_VERIFICATION_REQUIRED');
  });

  it('an expired or tampered token is refused', async () => {
    const h = await hashGuestEmail(SECRET, 'old@client.test');
    const expired = `${guestCookieName(A.pub)}=${await signGuestToken(SECRET, A.pub, 'Old', h, -10)}`;
    expect((await call(A.pub, '', { method: 'POST', body: { content: 'x' }, cookie: expired })).status).toBe(401);
    const good = await signGuestToken(SECRET, A.pub, 'Real', h);
    const [data, sig] = good.split('.');
    const forgedData = btoa(JSON.stringify({ ...JSON.parse(atob(data.replace(/-/g, '+').replace(/_/g, '/'))), n: 'CEO' })).replace(/=+$/, '');
    expect((await call(A.pub, '', { method: 'POST', body: { content: 'x' }, cookie: `${guestCookieName(A.pub)}=${forgedData}.${sig}` })).status).toBe(401);
    const otherSecret = `${guestCookieName(A.pub)}=${await signGuestToken('another-secret', A.pub, 'Real', h)}`;
    expect((await call(A.pub, '', { method: 'POST', body: { content: 'x' }, cookie: otherSecret })).status).toBe(401);
  });

  it('is CSRF-safe: a guest cookie only counts from this instance (no foreign, missing or opaque Origin)', async () => {
    const cookie = await guestCookie(A.pub);
    for (const origin of ['https://evil.test', null, 'null']) {
      const res = await call(A.pub, '', { method: 'POST', body: { content: 'csrf' }, cookie, origin });
      expect(res.status).toBe(401);
      const code = await call(A.pub, '/_guest/code', { method: 'POST', body: { name: 'E', email: 'e@client.test' }, origin });
      expect(code.status).toBe(403);
      const out = await call(A.pub, '/_guest', { method: 'DELETE', cookie, origin });
      expect(out.status).toBe(403);
    }
    const sub = await call(A.pub, '', { method: 'POST', body: { content: 'from a workspace subdomain' }, cookie, origin: 'https://team.shareout.test' });
    expect(sub.status).toBe(201);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM artifact_comments WHERE content = 'csrf'").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('can reply, but never resolve, assign or react', async () => {
    const cookie = await guestCookie(A.pub, 'Rita', 'rita@client.test');
    const root = await (await call(A.pub, '', { method: 'POST', body: { content: 'root' }, cookie })).json() as { data: { id: string } };
    const reply = await call(A.pub, '', { method: 'POST', body: { content: 'reply', parentId: root.data.id }, cookie });
    expect(reply.status).toBe(201);
    const id = root.data.id;
    expect((await call(A.pub, `/${id}/resolve`, { method: 'PATCH', body: { resolved: true }, cookie })).status).toBe(403);
    expect((await call(A.pub, `/${id}/assign`, { method: 'PATCH', body: { assignee: owner.email }, cookie })).status).toBe(401);
    expect((await call(A.pub, `/${id}/reactions`, { method: 'POST', body: { emoji: '👍' }, cookie })).status).toBe(401);
    expect((await call(A.pub, '', { method: 'POST', body: { content: 'assign', assignee: owner.email }, cookie })).status).toBe(401);
    const row = await env.DB.prepare('SELECT resolved, assignee_email FROM artifact_comments WHERE id = ?').bind(id).first();
    expect(row).toEqual({ resolved: 0, assignee_email: null });
  });

  it('the owner can delete a guest comment; the guest cannot', async () => {
    const cookie = await guestCookie(A.pub, 'Gil', 'gil@client.test');
    const made = await (await call(A.pub, '', { method: 'POST', body: { content: 'delete me' }, cookie })).json() as { data: { id: string } };
    expect((await call(A.pub, `/${made.data.id}`, { method: 'DELETE', cookie })).status).toBe(403);
    const ownerCookie = `shareout_session=${await createSessionToken(owner.id, owner.email, env)}`;
    expect((await call(A.pub, `/${made.data.id}`, { method: 'DELETE', cookie: ownerCookie })).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM artifact_comments WHERE id = ?').bind(made.data.id).first()).toBeNull();
  });

  it('is rate limited per guest token and per IP', async () => {
    const cookie = await guestCookie(A.pub2, 'Sam', 'sam@client.test');
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await call(A.pub2, '', { method: 'POST', body: { content: `n${i}` }, cookie, ip: `10.1.${i}.1` })).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);

    const perIp: number[] = [];
    for (let i = 0; i < 11; i++) {
      perIp.push((await call(A.pub2, '/_guest/code', { method: 'POST', body: { name: 'N', email: `n${i}@client.test` }, ip: '10.9.9.9' })).status);
    }
    expect(perIp.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(perIp[10]).toBe(429);
  });

  it('in anonymous mode a guest is optional, but a token still names the author', async () => {
    configs.set(A.pub2, { identityMode: 'anonymous', guestComments: true });
    const anon = await (await call(A.pub2, '', { method: 'POST', body: { content: 'anon' }, ip: '10.3.3.3' })).json() as { data: Record<string, unknown> };
    expect(anon.data).toMatchObject({ authorName: 'Anonymous', authorType: 'human' });
    const named = await (await call(A.pub2, '', { method: 'POST', body: { content: 'named' }, cookie: await guestCookie(A.pub2, 'Vera', 'vera@client.test'), ip: '10.3.3.4' })).json() as { data: Record<string, unknown> };
    expect(named.data).toMatchObject({ authorName: 'Vera', authorType: 'guest' });
  });
});
