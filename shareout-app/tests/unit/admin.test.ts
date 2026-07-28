import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAdminPage } from '../../src/admin';
import type { Env } from '../../src/types';

vi.mock('../../src/api-auth', () => ({
  validateAdminSession: vi.fn(),
}));

vi.mock('../../src/auth', () => ({
  getSessionUser: vi.fn(),
}));

vi.mock('../../src/analytics', () => ({
  getAnalytics: vi.fn(),
}));

import { validateAdminSession } from '../../src/api-auth';
import { getSessionUser } from '../../src/auth';
import { getAnalytics } from '../../src/analytics';

const baseEnv = {
  SHAREOUT_BASE_URL: 'https://shareout.example.com',
  SESSION_SECRET: 'test-session-secret',
} as Env;

const deployment = {
  id: 'art_1',
  name: 'Test <Page>',
  slug: 'test-page',
  visibility: 'public',
  created_at: '2024-01-01T00:00:00Z',
  owner_id: 'usr_owner',
};

const analyticsSummary = {
  totalViews: 1500,
  uniqueVisitors: 320,
  dailyStats: [
    { date: '2024-01-01', views: 100 },
    { date: '2024-01-02', views: 200 },
  ],
  topReferrers: [
    { name: 'https://google.com/search?q=test', count: 50 },
    { name: 'direct-very-long-referrer-string-that-exceeds-thirty-chars', count: 10 },
  ],
  topCountries: [
    { name: 'US', count: 80 },
    { name: 'ZZ', count: 5 },
  ],
  viewerTracking: [
    {
      email: 'viewer@example.com',
      name: null,
      hasViewed: true,
      firstViewedAt: 1704067200,
      lastViewedAt: 1704153600,
      viewCount: 3,
    },
    {
      email: 'pending@example.com',
      name: null,
      hasViewed: false,
      firstViewedAt: null,
      lastViewedAt: null,
      viewCount: 0,
    },
  ],
};

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
      })),
    })),
  } as unknown as Env['DB'];
}

function deploymentDb(extra?: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
}): Env['DB'] {
  return makeDbMock({
    first: (sql, ...args) => {
      if (sql.includes('FROM deployments d')) return deployment;
      if (sql.includes('version_id FROM deployments')) return { version_id: 'ver_2' };
      if (sql.includes('FROM users WHERE id = ? AND email')) return extra?.first?.(sql, ...args) ?? { '1': 1 };
      if (sql.includes('FROM collaborators')) return extra?.first?.(sql, ...args) ?? null;
      if (sql.includes('SELECT id FROM users WHERE email')) return extra?.first?.(sql, ...args) ?? null;
      return extra?.first?.(sql, ...args) ?? null;
    },
    all: (sql, ...args) => {
      if (sql.includes('FROM versions')) {
        return {
          results: [
            { id: 'ver_2', version_no: 2, entrypoint: 'index.html', created_at: 1704067200 },
            { id: 'ver_1', version_no: 1, entrypoint: 'index.html', created_at: 1703980800 },
          ],
        };
      }
      return extra?.all?.(sql, ...args) ?? { results: [] };
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function mintSignedAdminCookie(env: Env, slug = 'test-page'): Promise<string> {
  vi.mocked(validateAdminSession).mockResolvedValue({
    artifactId: 'art_1',
    userId: 'usr_owner',
  });

  const response = await handleAdminPage(
    new Request(`https://shareout.example.com/a/${slug}/admin?session=tok_abc`),
    env,
    slug,
  );
  const cookie = response.headers.get('Set-Cookie')?.match(/shareout_admin=([^;]+)/)?.[1];
  if (!cookie) throw new Error('Expected signed admin cookie');
  vi.mocked(validateAdminSession).mockResolvedValue(null);
  return cookie;
}

describe('handleAdminPage', () => {
  it('returns 404 when deployment slug is not found', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };
    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/missing/admin'),
      env,
      'missing',
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('404');
  });

  it('redirects and sets admin cookie when session token is valid', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue({
      artifactId: 'art_1',
      userId: 'usr_owner',
    });

    const env = { ...baseEnv, DB: deploymentDb() };
    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin?session=tok_abc'),
      env,
      'test-page',
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://shareout.example.com/a/test-page/admin');
    const cookie = response.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/shareout_admin=[^.]+\.[^;]+/);
    expect(cookie).not.toContain('shareout_admin=art_1:usr_owner');
    expect(cookie).toContain('Path=/a/test-page/admin');
  });

  it('authorizes via signed admin cookie', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue({
      artifactId: 'art_1',
      userId: 'usr_owner',
    });
    const env = { ...baseEnv, DB: deploymentDb() };
    const sessionResponse = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin?session=tok_abc'),
      env,
      'test-page',
    );
    const signedCookie = sessionResponse.headers.get('Set-Cookie')?.match(/shareout_admin=([^;]+)/)?.[1];
    expect(signedCookie).toBeTruthy();

    vi.mocked(validateAdminSession).mockResolvedValue(null);
    vi.mocked(getAnalytics).mockResolvedValue(analyticsSummary);

    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin', {
        headers: { Cookie: `shareout_admin=${signedCookie}` },
      }),
      env,
      'test-page',
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Test &lt;Page&gt;');
    expect(html).toContain('Public');
    expect(getSessionUser).not.toHaveBeenCalled();
  });

  it('rejects forged plaintext admin cookie', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(null);
    vi.mocked(getSessionUser).mockResolvedValue(null);
    vi.mocked(getAnalytics).mockClear();

    const env = { ...baseEnv, DB: deploymentDb() };
    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin', {
        headers: { Cookie: 'shareout_admin=art_1:any-user-id' },
      }),
      env,
      'test-page',
    );

    expect(response.status).toBe(401);
    expect(getAnalytics).not.toHaveBeenCalled();
  });

  it('authorizes owner via session user', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(null);
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'usr_owner', email: 'owner@example.com' });
    vi.mocked(getAnalytics).mockResolvedValue(analyticsSummary);

    const env = { ...baseEnv, DB: deploymentDb() };
    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin'),
      env,
      'test-page',
    );

    expect(response.status).toBe(200);
  });

  it('authorizes editor collaborator via session user', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(null);
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'usr_collab', email: 'editor@example.com' });
    vi.mocked(getAnalytics).mockResolvedValue(analyticsSummary);

    const env = {
      ...baseEnv,
      DB: deploymentDb({
        first: (sql) => {
          if (sql.includes('FROM users WHERE id = ? AND email')) return null;
          if (sql.includes('FROM collaborators')) return { role: 'editor' };
          if (sql.includes('SELECT id FROM users WHERE email')) return { id: 'usr_collab' };
          return null;
        },
      }),
    };

    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin'),
      env,
      'test-page',
    );
    expect(response.status).toBe(200);
  });

  it('returns 401 for editor collaborator without user record', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(null);
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'usr_collab', email: 'editor@example.com' });

    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM deployments d')) return deployment;
          if (sql.includes('FROM users WHERE id = ? AND email')) return null;
          if (sql.includes('FROM collaborators')) return { role: 'editor' };
          if (sql.includes('SELECT id FROM users WHERE email')) return null;
          return null;
        },
      }),
    };

    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin'),
      env,
      'test-page',
    );
    expect(response.status).toBe(401);
  });

  it('ignores session token for a different artifact', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue({
      artifactId: 'art_other',
      userId: 'usr_1',
    });
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const env = { ...baseEnv, DB: deploymentDb() };
    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin?session=tok_abc'),
      env,
      'test-page',
    );
    expect(response.status).toBe(401);
  });

  it('returns 401 for viewer collaborator', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(null);
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'usr_view', email: 'viewer@example.com' });

    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM deployments d')) return deployment;
          if (sql.includes('FROM users WHERE id = ? AND email')) return null;
          if (sql.includes('FROM collaborators')) return { role: 'viewer' };
          return null;
        },
      }),
    };

    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin'),
      env,
      'test-page',
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('Admin Access Required');
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(null);
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const env = { ...baseEnv, DB: deploymentDb() };
    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin'),
      env,
      'test-page',
    );
    expect(response.status).toBe(401);
  });

  it('renders admin dashboard with analytics, versions, and tracking', async () => {
    const env = { ...baseEnv, DB: deploymentDb() };
    const cookie = await mintSignedAdminCookie(env);
    vi.mocked(getAnalytics).mockResolvedValue(analyticsSummary);

    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin', {
        headers: { Cookie: `shareout_admin=${cookie}` },
      }),
      env,
      'test-page',
    );

    const html = await response.text();
    expect(html).toContain('1,500');
    expect(html).toContain('320');
    expect(html).toContain('chart-bar');
    expect(html).toContain('Live');
    expect(html).toContain('v2');
    expect(html).toContain('google.com');
    expect(html).toContain('🇺🇸');
    expect(html).toContain('🌍');
    expect(html).toContain('viewer@example.com');
    expect(html).toContain('Viewed');
    expect(html).toContain('Not viewed');
  });

  it('renders empty states for sparse analytics', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM deployments d')) return deployment;
          if (sql.includes('version_id FROM deployments')) return null;
          return null;
        },
        all: () => ({ results: [] }),
      }),
    };
    const cookie = await mintSignedAdminCookie(env);
    vi.mocked(getAnalytics).mockResolvedValue({
      totalViews: 0,
      uniqueVisitors: 0,
      dailyStats: [],
      topReferrers: [],
      topCountries: [],
      viewerTracking: [],
    });

    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin', {
        headers: { Cookie: `shareout_admin=${cookie}` },
      }),
      env,
      'test-page',
    );

    const html = await response.text();
    expect(html).toContain('Views will appear here');
    expect(html).toContain('No versions yet');
    expect(html).toContain('No data yet');
    expect(html).toContain('No one shared with yet');
  });

  it('renders private badge for private artifacts', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM deployments d')) {
            return { ...deployment, visibility: 'private' };
          }
          if (sql.includes('version_id FROM deployments')) return null;
          return null;
        },
        all: () => ({ results: [] }),
      }),
    };
    const cookie = await mintSignedAdminCookie(env);
    vi.mocked(getAnalytics).mockResolvedValue({
      totalViews: 0,
      uniqueVisitors: 0,
      dailyStats: [],
      topReferrers: [],
      topCountries: [],
      viewerTracking: [],
    });

    const response = await handleAdminPage(
      new Request('https://shareout.example.com/a/test-page/admin', {
        headers: { Cookie: `shareout_admin=${cookie}` },
      }),
      env,
      'test-page',
    );

    expect(await response.text()).toContain('Private');
  });
});
