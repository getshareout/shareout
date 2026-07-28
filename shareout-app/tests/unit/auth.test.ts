import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accessDeniedPage,
  credentialsLoginPage,
  getSessionUser,
  handleCredentialsAuth,
  handleDevLogin,
  handleGoogleCallback,
  handleGoogleLogin,
  handleLinkGoogleStart,
  handleLogout,
  handlePasswordAuth,
  loginPage,
  passwordLoginPage,
  upsertUserByEmail,
  verifyAccessToken,
} from '../../src/auth';
import { SIGNUPS_PAUSED_MSG } from '../../src/signup-gate';
import { createAccessToken, createSessionToken } from '../../src/token';
import type { Env } from '../../src/types';

const baseEnv = {
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  SHAREOUT_BASE_URL: 'https://shareout.example.com',
  SESSION_SECRET: 'session-secret',
} as Env;

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true }),
      })),
    })),
  } as unknown as Env['DB'];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handleGoogleLogin', () => {
  it('redirects to Google OAuth with encoded state and redirect_uri', async () => {
    const response = await handleGoogleLogin(
      new Request('https://shareout.example.com/auth/google?redirect=/a/demo/'),
      baseEnv,
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location')!);
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('google-client');
    expect(location.searchParams.get('redirect_uri')).toBe('https://shareout.example.com/auth/callback');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(JSON.parse(atob(location.searchParams.get('state')!))).toEqual({
      redirect: '/a/demo/',
      returnOrigin: null,
    });
  });

  it('defaults redirect to / when missing', async () => {
    const response = await handleGoogleLogin(
      new Request('https://shareout.example.com/auth/google'),
      baseEnv,
    );
    const location = new URL(response.headers.get('Location')!);
    expect(JSON.parse(atob(location.searchParams.get('state')!))).toEqual({
      redirect: '/',
      returnOrigin: null,
    });
  });

  it('captures the subdomain origin so login returns to the subdomain', async () => {
    const response = await handleGoogleLogin(
      new Request('https://acme.shareout.example.com/auth/google?redirect=/home'),
      baseEnv,
    );
    const location = new URL(response.headers.get('Location')!);
    // The OAuth redirect_uri stays on the apex (only registered callback)...
    expect(location.searchParams.get('redirect_uri')).toBe(`${baseEnv.SHAREOUT_BASE_URL}/auth/callback`);
    // ...but the origin is preserved in state to bounce back to the subdomain.
    expect(JSON.parse(atob(location.searchParams.get('state')!))).toEqual({
      redirect: '/home',
      returnOrigin: 'https://acme.shareout.example.com',
    });
  });
});

describe('handleLinkGoogleStart', () => {
  it('redirects with linkUserId and linkAction in state', async () => {
    const response = await handleLinkGoogleStart('usr_abc', '/settings', baseEnv);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location')!);
    expect(JSON.parse(atob(location.searchParams.get('state')!))).toEqual({
      redirect: '/settings',
      linkUserId: 'usr_abc',
      linkAction: 'google',
    });
  });
});

describe('handleLogout', () => {
  it('clears session cookie and redirects', async () => {
    const response = await handleLogout(
      new Request('https://shareout.example.com/auth/logout?redirect=/home'),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/home');
    const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toContain('shareout_session=');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Secure');
  });

  it('omits Secure on http localhost', async () => {
    const response = await handleLogout(
      new Request('http://localhost/auth/logout'),
    );
    expect(response.headers.get('Set-Cookie')).not.toContain('Secure');
  });

  it('clears both the domain-scoped and legacy host-only cookie on shareout.site', async () => {
    const response = await handleLogout(
      new Request('https://acme.shareout.site/auth/logout'),
    );

    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.some((c) => c.includes('Domain=.shareout.site') && c.includes('Max-Age=0'))).toBe(true);
    expect(cookies.some((c) => !c.includes('Domain=') && c.includes('Max-Age=0'))).toBe(true);
  });
});

describe('getSessionUser', () => {
  it('returns user from a valid session cookie', async () => {
    const token = await createSessionToken('usr_1', 'user@example.com', baseEnv);
    const request = new Request('https://shareout.example.com/', {
      headers: { Cookie: `shareout_session=${token}` },
    });

    await expect(getSessionUser(request, baseEnv)).resolves.toEqual({
      id: 'usr_1',
      email: 'user@example.com',
    });
  });

  it('returns null when cookie is missing or invalid', async () => {
    const request = new Request('https://shareout.example.com/');
    await expect(getSessionUser(request, baseEnv)).resolves.toBeNull();

    const badRequest = new Request('https://shareout.example.com/', {
      headers: { Cookie: 'shareout_session=not-valid' },
    });
    await expect(getSessionUser(badRequest, baseEnv)).resolves.toBeNull();
  });

  it('serves the disable flag from KV without touching D1, and caches a D1 miss', async () => {
    const token = await createSessionToken('usr_1', 'user@example.com', baseEnv);
    const request = () => new Request('https://shareout.example.com/', {
      headers: { Cookie: `shareout_session=${token}` },
    });

    // KV hit '1' (disabled) → null, no DB read
    const dbDisabled = vi.fn();
    const kvDisabled = { get: vi.fn(async () => '1'), put: vi.fn(), delete: vi.fn() };
    await expect(getSessionUser(request(), { ...baseEnv, SLUGS: kvDisabled, DB: { prepare: dbDisabled } } as unknown as Env)).resolves.toBeNull();
    expect(dbDisabled).not.toHaveBeenCalled();

    // KV hit '0' (enabled) → user, no DB read
    const dbEnabled = vi.fn();
    const kvEnabled = { get: vi.fn(async () => '0'), put: vi.fn(), delete: vi.fn() };
    await expect(getSessionUser(request(), { ...baseEnv, SLUGS: kvEnabled, DB: { prepare: dbEnabled } } as unknown as Env))
      .resolves.toEqual({ id: 'usr_1', email: 'user@example.com' });
    expect(dbEnabled).not.toHaveBeenCalled();

    // KV miss → D1 read → put the result
    const kvMiss = { get: vi.fn(async () => null), put: vi.fn(async () => {}), delete: vi.fn() };
    const db = makeDbMock({ first: (sql) => (sql.includes('disabled FROM users') ? { disabled: 0 } : null) });
    await expect(getSessionUser(request(), { ...baseEnv, SLUGS: kvMiss, DB: db } as unknown as Env))
      .resolves.toEqual({ id: 'usr_1', email: 'user@example.com' });
    expect(kvMiss.put).toHaveBeenCalledWith('userdisabled:usr_1', '0', { expirationTtl: 60 });
  });
});

describe('upsertUserByEmail', () => {
  it('blocks brand-new email accounts when signups are paused', async () => {
    const env = {
      ...baseEnv,
      SIGNUPS_PAUSED: 'true',
      DB: makeDbMock(),
    };

    await expect(upsertUserByEmail(env, 'supplier@example.com')).rejects.toThrow(SIGNUPS_PAUSED_MSG);
  });

  it('allows brand-new emails that were explicitly invited to an artifact', async () => {
    const inserts: unknown[][] = [];
    const env = {
      ...baseEnv,
      SIGNUPS_PAUSED: 'true',
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM collaborators')) return { invited: 1 };
          return null;
        },
        run: (_sql, ...args) => {
          inserts.push(args);
          return { success: true };
        },
      }),
    };

    const user = await upsertUserByEmail(env, 'Supplier@Provider1.com');

    expect(user.email).toBe('supplier@provider1.com');
    expect(user.isNew).toBe(true);
    expect(user.firstActivation).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toBe('supplier@provider1.com');
    expect(inserts[0][2]).toBe('supplier');
  });

  it('marks firstActivation for a pre-created invitee (row exists, never logged in)', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM users WHERE email')) {
            return { id: 'usr_pre', email: 'invitee@example.com', last_login_at: null };
          }
          return null;
        },
      }),
    };
    const user = await upsertUserByEmail(env, 'invitee@example.com');
    expect(user.isNew).toBe(false);
    expect(user.firstActivation).toBe(true);
    expect(user.id).toBe('usr_pre');
  });

  it('marks firstActivation false for a returning email user', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM users WHERE email')) {
            return { id: 'usr_old', email: 'old@example.com', last_login_at: '2026-01-01' };
          }
          return null;
        },
      }),
    };
    const user = await upsertUserByEmail(env, 'old@example.com');
    expect(user.isNew).toBe(false);
    expect(user.firstActivation).toBe(false);
  });

  it('allows brand-new emails on a workspace allowed domain while signups are paused', async () => {
    const inserts: unknown[][] = [];
    const env = {
      ...baseEnv,
      SIGNUPS_PAUSED: 'true',
      DB: makeDbMock({
        first: () => null,
        all: () => ({
          results: [{ allowed_email_domains: JSON.stringify(['acme.example']), allowed_emails: null }],
        }),
        run: (_sql, ...args) => {
          inserts.push(args);
          return { success: true };
        },
      }),
    };

    const user = await upsertUserByEmail(env, 'new@acme.example');

    expect(user.email).toBe('new@acme.example');
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toBe('new@acme.example');
  });
});

describe('verifyAccessToken', () => {
  it('returns true for a valid artifact access cookie', async () => {
    const token = await createAccessToken('art_1', 'password', baseEnv);
    const request = new Request('https://shareout.example.com/a/demo/', {
      headers: { Cookie: `shareout_access_art_1=${token}` },
    });

    await expect(verifyAccessToken(request, baseEnv, 'art_1')).resolves.toBe(true);
  });

  it('returns false when cookie is missing or invalid', async () => {
    const request = new Request('https://shareout.example.com/a/demo/');
    await expect(verifyAccessToken(request, baseEnv, 'art_1')).resolves.toBe(false);

    const token = await createAccessToken('art_2', 'password', baseEnv);
    const wrongArtifact = new Request('https://shareout.example.com/a/demo/', {
      headers: { Cookie: `shareout_access_art_1=${token}` },
    });
    await expect(verifyAccessToken(wrongArtifact, baseEnv, 'art_1')).resolves.toBe(false);
  });
});

describe('loginPage', () => {
  it('returns 401 HTML with escaped slug and no artifact title leak', async () => {
    const response = loginPage('<script>alert(1)</script>', 'Name & Co');
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    // Slug is still needed for the post-login redirect path.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // Private gates must not reveal the artifact name to unauthorized visitors.
    expect(html).not.toContain('Name &amp; Co');
    expect(html).toContain('Private content');
    expect(html).toContain('/auth/google?redirect=');
  });

  it('offers one-time email code sign-in for private artifact viewers', async () => {
    const response = loginPage('supplier-scorecard', 'Supplier Scorecard');
    const html = await response.text();

    expect(html).toContain('Sign in with Google');
    expect(html).toContain('id="email-code-start"');
    expect(html).toContain('type="email"');
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('/v1/auth/email/start');
    expect(html).toContain('/v1/auth/email/verify');
    expect(html).toContain('window.location.href = redirectAfter');
    expect(html).not.toContain('Supplier Scorecard');

    const marker = "var startForm = document.getElementById('email-code-start');";
    const markerIndex = html.indexOf(marker);
    const scriptStart = html.lastIndexOf('<script>', markerIndex);
    const scriptEnd = html.indexOf('</script>', markerIndex);
    const script = html.slice(scriptStart + '<script>'.length, scriptEnd);
    expect(() => new Function(script)).not.toThrow();
  });

  it('never emits Open Graph tags on private gates (even if social preview is passed)', async () => {
    const response = loginPage('demo', 'My Artifact', {
      title: 'Preview Title',
      description: 'Preview description',
      imageUrl: 'https://shareout.site/t/art_demo.webp',
      canonicalUrl: 'https://shareout.site/a/demo/',
    });
    const html = await response.text();

    expect(html).not.toContain('og:title');
    expect(html).not.toContain('Preview Title');
    expect(html).not.toContain('art_demo.webp');
  });
});

describe('accessDeniedPage', () => {
  it('returns 403 HTML with request access UI when signed in', async () => {
    const page = accessDeniedPage({
      slug: 'demo',
      artifactName: 'My Artifact',
      userEmail: 'viewer@example.com',
    });
    const html = await page.text();
    expect(page.status).toBe(403);
    expect(page.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(html).toContain('You need access');
    expect(html).toContain('Request access');
    expect(html).toContain('viewer@example.com');
    expect(html).toContain('Switch account');
    expect(html).not.toContain('My Artifact');
    expect(html).not.toContain('Access Denied');
  });

  it('shows pending state when request already sent', async () => {
    const page = accessDeniedPage({
      slug: 'demo',
      artifactName: 'My Artifact',
      userEmail: 'viewer@example.com',
      requestPending: true,
    });
    const html = await page.text();
    expect(html).toContain('Access request sent');
    expect(html).not.toContain('id="accessRequestBtn"');
  });
});

describe('passwordLoginPage', () => {
  it('always returns 401 and never reveals the artifact title', async () => {
    const secretTitle = 'Q3 Board Compensation Memo';
    const ok = passwordLoginPage('demo', secretTitle);
    expect(ok.status).toBe(401);
    expect(ok.headers.get('X-Robots-Tag')).toContain('noindex');
    const okHtml = await ok.text();
    expect(okHtml).not.toContain(secretTitle);
    expect(okHtml).not.toContain('<div class="error-box">');
    expect(okHtml).toContain('Password required');

    const bad = passwordLoginPage('demo', secretTitle, 'Wrong password');
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain('Wrong password');
  });
});

describe('credentialsLoginPage', () => {
  it('always returns 401 and never reveals the artifact title', async () => {
    const secretTitle = 'Q3 Board Compensation Memo';
    const ok = credentialsLoginPage('demo', secretTitle);
    expect(ok.status).toBe(401);
    expect(await ok.text()).not.toContain(secretTitle);

    const bad = credentialsLoginPage('demo', secretTitle, 'Invalid username or password');
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain('Invalid username or password');
  });
});

describe('handlePasswordAuth', () => {
  it('rejects missing slug or password', async () => {
    const form = new FormData();
    form.set('slug', 'demo');
    const response = await handlePasswordAuth(
      new Request('https://shareout.example.com/auth/password', { method: 'POST', body: form }),
      baseEnv,
    );
    expect(response.status).toBe(400);
  });

  it('returns 404 when artifact is missing or has no password', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    const form = new FormData();
    form.set('slug', 'missing');
    form.set('password', 'secret');

    const response = await handlePasswordAuth(
      new Request('https://shareout.example.com/auth/password', { method: 'POST', body: form }),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('returns login page on incorrect password', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ id: 'art_1', name: 'Demo', password_hash: 'deadbeef' }),
      }),
    };
    const form = new FormData();
    form.set('slug', 'demo');
    form.set('password', 'wrong');

    const response = await handlePasswordAuth(
      new Request('https://shareout.example.com/auth/password', { method: 'POST', body: form }),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('Incorrect password');
  });

  it('sets access cookie and redirects on success', async () => {
    const passwordHash = await sha256('secret123');
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ id: 'art_1', name: 'Demo', password_hash: passwordHash }),
      }),
    };
    const form = new FormData();
    form.set('slug', 'demo');
    form.set('password', 'secret123');

    const response = await handlePasswordAuth(
      new Request('https://shareout.example.com/auth/password', { method: 'POST', body: form }),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/a/demo/');
    expect(response.headers.get('Set-Cookie')).toContain('shareout_access_art_1=');
  });

  it('resolves by artifact_id (not the now-ambiguous slug) when the form carries one', async () => {
    const passwordHash = await sha256('secret123');
    const seen: string[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => { seen.push(sql); return { id: 'art_42', name: 'Demo', password_hash: passwordHash }; },
      }),
    };
    const form = new FormData();
    form.set('slug', 'my-demo');
    form.set('artifact_id', 'art_42');
    form.set('password', 'secret123');

    const response = await handlePasswordAuth(
      new Request('https://shareout.example.com/auth/password', { method: 'POST', body: form }),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toContain('shareout_access_art_42=');
    expect(seen.some(s => s.includes('FROM artifacts WHERE id = ?'))).toBe(true);
    expect(seen.some(s => s.includes('JOIN deployments'))).toBe(false);
  });

  it('falls back to the global routing slug (deployment join) when no artifact_id', async () => {
    const seen: string[] = [];
    const env = { ...baseEnv, DB: makeDbMock({ first: (sql) => { seen.push(sql); return null; } }) };
    const form = new FormData();
    form.set('slug', 'routing-slug');
    form.set('password', 'secret');

    const response = await handlePasswordAuth(
      new Request('https://shareout.example.com/auth/password', { method: 'POST', body: form }),
      env,
    );

    expect(response.status).toBe(404);
    expect(seen.some(s => s.includes('JOIN deployments') && s.includes('d.slug = ?'))).toBe(true);
  });
});

describe('handleCredentialsAuth', () => {
  it('rejects missing fields', async () => {
    const form = new FormData();
    form.set('slug', 'demo');
    form.set('username', 'alice');
    const response = await handleCredentialsAuth(
      new Request('https://shareout.example.com/auth/credentials', { method: 'POST', body: form }),
      baseEnv,
    );
    expect(response.status).toBe(400);
  });

  it('returns 404 when artifact is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    const form = new FormData();
    form.set('slug', 'missing');
    form.set('username', 'alice');
    form.set('password', 'secret');

    const response = await handleCredentialsAuth(
      new Request('https://shareout.example.com/auth/credentials', { method: 'POST', body: form }),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('returns login page on invalid credentials', async () => {
    let call = 0;
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          call += 1;
          if (call === 1) return { id: 'art_1', name: 'Demo' };
          if (sql.includes('artifact_passwords')) return null;
          return null;
        },
      }),
    };
    const form = new FormData();
    form.set('slug', 'demo');
    form.set('username', 'alice');
    form.set('password', 'secret');

    const response = await handleCredentialsAuth(
      new Request('https://shareout.example.com/auth/credentials', { method: 'POST', body: form }),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('Invalid username or password');
  });

  it('sets access cookie and redirects on success', async () => {
    const passwordHash = await sha256('secret');
    let call = 0;
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          call += 1;
          if (call === 1) return { id: 'art_1', name: 'Demo' };
          if (sql.includes('artifact_passwords')) return { 1: 1 };
          return null;
        },
      }),
    };
    const form = new FormData();
    form.set('slug', 'demo');
    form.set('username', 'Alice');
    form.set('password', 'secret');

    const response = await handleCredentialsAuth(
      new Request('https://shareout.example.com/auth/credentials', { method: 'POST', body: form }),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/a/demo/');
    expect(response.headers.get('Set-Cookie')).toContain('shareout_access_art_1=');
  });
});

describe('handleDevLogin', () => {
  it('returns 404 outside localhost', async () => {
    const response = await handleDevLogin(
      new Request('https://shareout.example.com/auth/dev?email=dev@example.com'),
      baseEnv,
    );
    expect(response.status).toBe(404);
  });

  it('returns 400 when email is missing', async () => {
    const response = await handleDevLogin(
      new Request('http://localhost/auth/dev'),
      baseEnv,
    );
    expect(response.status).toBe(400);
  });

  it('creates a new user and session on localhost', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => null,
        run: () => ({ success: true }),
      }),
    };
    const response = await handleDevLogin(
      new Request('http://localhost/auth/dev?email=NewDev@Example.com&redirect=/dash'),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dash');
    expect(response.headers.get('Set-Cookie')).toContain('shareout_session=');
    expect(env.DB.prepare).toHaveBeenCalled();
  });

  it('reuses existing user and updates last_login_at', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ id: 'usr_existing', email: 'dev@example.com' }),
        run: () => ({ success: true }),
      }),
    };
    const response = await handleDevLogin(
      new Request('http://127.0.0.1/auth/dev?email=dev@example.com'),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toContain('shareout_session=');
  });
});

describe('handleGoogleCallback', () => {
  it('returns error page when OAuth error param is present', async () => {
    const response = await handleGoogleCallback(
      new Request('https://shareout.example.com/auth/callback?error=access_denied&error_description=User+cancelled'),
      baseEnv,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('access_denied');
  });

  it('returns error page when authorization code is missing', async () => {
    const response = await handleGoogleCallback(
      new Request('https://shareout.example.com/auth/callback'),
      baseEnv,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Missing authorization code');
  });

  it('creates session after successful token exchange for new user', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = url.toString();
      if (target.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', id_token: 'id' }), { status: 200 });
      }
      if (target.includes('userinfo')) {
        return new Response(JSON.stringify({
          id: 'google_1',
          email: 'user@example.com',
          name: 'Test User',
          picture: 'https://example.com/p.png',
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    }));

    let googleLookup = 0;
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('google_id')) {
            googleLookup += 1;
            return null;
          }
          return null;
        },
        run: () => ({ success: true }),
      }),
    };

    const state = btoa(JSON.stringify({ redirect: '/dashboard' }));
    const response = await handleGoogleCallback(
      new Request(`https://shareout.example.com/auth/callback?code=abc&state=${encodeURIComponent(state)}`),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');
    expect(response.headers.get('Set-Cookie')).toContain('shareout_session=');
    expect(googleLookup).toBeGreaterThan(0);
  });

  it('returns to the subdomain and sets a zone-wide cookie', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = url.toString();
      if (target.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', id_token: 'id' }), { status: 200 });
      }
      if (target.includes('userinfo')) {
        return new Response(JSON.stringify({
          id: 'google_2', email: 'user@example.com', name: 'Test User', picture: 'https://example.com/p.png',
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    }));

    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => null, run: () => ({ success: true }) }),
    };

    const state = btoa(JSON.stringify({ redirect: '/home', returnOrigin: 'https://acme.shareout.example.com' }));
    const response = await handleGoogleCallback(
      new Request(`https://shareout.example.com/auth/callback?code=abc&state=${encodeURIComponent(state)}`),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://acme.shareout.example.com/home');
    expect(response.headers.get('Set-Cookie')).toContain('Domain=.shareout.example.com');
  });

  it('adopts an existing email-linked account instead of duplicating the email', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = url.toString();
      if (target.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', id_token: 'id' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'google_new', email: 'linked@example.com', name: 'Linked User', picture: 'https://example.com/p.png',
      }), { status: 200 });
    }));

    const runCalls: string[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('WHERE google_id')) return null;            // no Google match yet
          if (sql.includes('WHERE email')) return { id: 'usr_api', google_id: null }; // API-created, email-linked
          return null;
        },
        run: (sql) => { runCalls.push(sql); return { success: true }; },
      }),
    };

    const state = btoa(JSON.stringify({ redirect: '/home' }));
    const response = await handleGoogleCallback(
      new Request(`https://shareout.site/auth/callback?code=abc&state=${encodeURIComponent(state)}`),
      env,
    );

    expect(response.status).toBe(302);
    // Adopts the existing account: an UPDATE that sets google_id, never an INSERT.
    expect(runCalls.some((s) => s.includes('UPDATE users SET google_id'))).toBe(true);
    expect(runCalls.some((s) => s.startsWith('INSERT INTO users'))).toBe(false);
  });

  it('returns error page when token exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid_grant', { status: 400 })));

    const response = await handleGoogleCallback(
      new Request('https://shareout.example.com/auth/callback?code=bad'),
      baseEnv,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Auth error');
  });

  it('updates existing user on repeat Google login', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = url.toString();
      if (target.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', id_token: 'id' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'google_existing',
        email: 'existing@example.com',
        name: 'Existing User',
        picture: 'https://example.com/p.png',
      }), { status: 200 });
    }));

    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('google_id')) {
            return { id: 'usr_existing', email: 'existing@example.com' };
          }
          return null;
        },
        run: () => ({ success: true }),
      }),
    };

    const response = await handleGoogleCallback(
      new Request('https://shareout.example.com/auth/callback?code=abc'),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toContain('shareout_session=');
  });

  it('links Google account to an existing user', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = url.toString();
      if (target.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', id_token: 'id' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'google_link',
        email: 'linked@example.com',
        name: 'Linked User',
        picture: 'https://example.com/p.png',
      }), { status: 200 });
    }));

    let googleLookup = 0;
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('WHERE google_id = ?')) {
            googleLookup += 1;
            return null;
          }
          if (sql.includes('WHERE id = ?')) {
            return { id: String(args[0]), google_id: null };
          }
          return null;
        },
        run: () => ({ success: true }),
      }),
    };

    const state = btoa(JSON.stringify({
      redirect: '/settings',
      linkUserId: 'usr_link',
      linkAction: 'google',
    }));
    const response = await handleGoogleCallback(
      new Request(`https://shareout.example.com/auth/callback?code=abc&state=${encodeURIComponent(state)}`),
      env,
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Account Linked');
    expect(html).toContain('linked@example.com');
    expect(googleLookup).toBeGreaterThan(0);
  });
});
