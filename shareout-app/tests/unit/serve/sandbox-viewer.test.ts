import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serveSandboxedViewer } from '../../../src/serve/sandbox-viewer';
import type { Env } from '../../../src/types';

const prefetchMocks = vi.hoisted(() => ({
  fetchInitialJsonData: vi.fn(),
  fetchInitialTableData: vi.fn(),
  detectAdminStatus: vi.fn(),
  detectFavoriteState: vi.fn(),
  detectCommentsState: vi.fn(),
  fetchAttachedSkills: vi.fn(),
}));

vi.mock('../../../src/serve/prefetch', () => prefetchMocks);
vi.mock('../../../src/analytics', () => ({ trackPageView: vi.fn(async () => undefined) }));
vi.mock('../../../src/auth', () => ({ getSessionUser: vi.fn(async () => null) }));
vi.mock('../../../src/view-tracking', () => ({ trackViewerView: vi.fn(async () => undefined) }));
vi.mock('../../../src/scheduling/events', () => ({ maybeEmitViewEvent: vi.fn(async () => undefined) }));

function makeEnv(accessPolicy: string | null = null, extra: Partial<Env> = {}): Env {
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes('access_policy FROM artifacts')) {
            return { access_policy: accessPolicy };
          }
          if (sql.includes('SELECT manifest_json FROM versions')) {
            return null;
          }
          return null;
        }),
        all: vi.fn(async () => ({ results: [] })),
      })),
    })),
  } as unknown as Env['DB'];

  return {
    DB,
    ARTIFACTS: { get: vi.fn() },
    SHAREOUT_BASE_URL: 'https://shareout.example.com',
    SESSION_SECRET: 'test-secret',
    ...extra,
  } as unknown as Env;
}

// Cutover live: artifacts serve from per-id subdomains of shareoutcdn.site.
function makeCdnEnv(accessPolicy: string | null = null, extra: Partial<Env> = {}): Env {
  return makeEnv(accessPolicy, { ARTIFACT_ORIGIN: 'https://shareoutcdn.site', ...extra } as Partial<Env>);
}

const demoSocialPreview = {
  title: 'Demo Dashboard',
  description: 'A live ShareOut artifact',
  imageUrl: 'https://shareout.example.com/t/art_1.webp',
  canonicalUrl: 'https://shareout.example.com/a/demo/',
};

async function render(
  env: Env,
  socialPreview = demoSocialPreview,
  visibility = 'public',
  accessPolicy: string | null = null,
  request = new Request('https://shareout.example.com/a/demo/'),
): Promise<string> {
  const response = await serveSandboxedViewer(
    request,
    env,
    'demo',
    'index.html',
    'ver_1',
    'art_1abc2def3456789012345678',
    null,
    visibility,
    accessPolicy,
    null,
    null,
    null,
    socialPreview,
  );
  return response.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  prefetchMocks.fetchInitialJsonData.mockResolvedValue(null);
  prefetchMocks.fetchInitialTableData.mockResolvedValue(null);
  prefetchMocks.detectAdminStatus.mockResolvedValue(null);
  prefetchMocks.detectFavoriteState.mockResolvedValue({ loggedIn: false, isFavorite: false });
  prefetchMocks.detectCommentsState.mockResolvedValue({ loggedIn: false, enabled: false, count: 0, identityMode: 'anonymous' });
  prefetchMocks.fetchAttachedSkills.mockResolvedValue([]);
});

describe('serveSandboxedViewer initial data', () => {
  it('escapes JSON before embedding it in script tags', async () => {
    prefetchMocks.fetchInitialJsonData.mockResolvedValue({
      keys: ['payload'],
      data: {
        payload: '</script><script>window.pwned=1</script>',
      },
    });

    const html = await render(makeEnv());

    expect(html).not.toContain('</script><script>window.pwned=1</script>');
    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003ewindow.pwned=1\\u003c/script\\u003e');
  });

  it('injects Open Graph tags for link previews', async () => {
    const html = await render(makeEnv());

    expect(html).toContain('<title>Demo Dashboard | ShareOut</title>');
    expect(html).toContain('property="og:title" content="Demo Dashboard"');
    expect(html).toContain('property="og:description" content="A live ShareOut artifact"');
    expect(html).toContain('property="og:image" content="https://shareout.example.com/t/art_1.webp"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it('skips unscoped initial data prefetch when an access policy is configured', async () => {
    const html = await render(makeEnv(), demoSocialPreview, 'public', JSON.stringify({
      version: 1,
      field: 'account_id',
      identity: 'email',
      rules: [],
    }));

    expect(html).toContain('shareout-initial-data');
    expect(prefetchMocks.fetchInitialJsonData).not.toHaveBeenCalled();
    expect(prefetchMocks.fetchInitialTableData).not.toHaveBeenCalled();
  });
});

describe('serveSandboxedViewer iframe origin (ADR 30)', () => {
  const LABEL = '1abc2def3456789012345678';

  it('legacy: embeds a same-origin ?_raw iframe when ARTIFACT_ORIGIN is the app domain', async () => {
    const html = await render(makeEnv(), demoSocialPreview, 'private');
    expect(html).toContain('src="https://shareout.example.com/a/demo/index.html?_raw"');
    expect(html).not.toContain('shareoutcdn.site');
  });

  it('cutover (public): embeds a per-id subdomain iframe with no capability token', async () => {
    const html = await render(makeCdnEnv(), demoSocialPreview, 'public');
    expect(html).toContain(`src="https://${LABEL}.shareoutcdn.site/index.html"`);
    expect(html).not.toContain('/c/');
    // Drops same-origin preloads in favour of a preconnect to the content host.
    expect(html).toContain(`<link rel="preconnect" href="https://${LABEL}.shareoutcdn.site">`);
    // Early bridge hook streams with the iframe so init can fire before prefetch ends.
    expect(html).toContain('__shareoutDeliverInit');
    expect(html).toContain('"artifactId":"art_1abc2def3456789012345678"');
  });

  it('cutover (private): embeds a /c/<ct>/ capability-token iframe even with no logged-in viewer', async () => {
    const html = await render(makeCdnEnv(), demoSocialPreview, 'private');
    const m = html.match(new RegExp(`src="https://${LABEL}\\.shareoutcdn\\.site/c/([^/]+)/index\\.html"`));
    expect(m).not.toBeNull();
    // The token must exist independent of a Google session (password-protected case).
    expect(m![1].length).toBeGreaterThan(10);
  });

  it('local QA: loopback requests stay same-origin even when ARTIFACT_ORIGIN points at the CDN', async () => {
    const html = await render(
      makeCdnEnv(null, { SHAREOUT_BASE_URL: 'http://127.0.0.1:55162' }),
      demoSocialPreview,
      'private',
      null,
      new Request('http://localhost/a/demo/'),
    );

    expect(html).toContain('src="http://127.0.0.1:55162/a/demo/index.html?_raw"');
    expect(html).not.toContain('shareoutcdn.site');
    expect(html).not.toContain('/c/');
  });

  it('local QA: restores the default Wrangler dev port when request.url omits it', async () => {
    const html = await render(
      makeCdnEnv(),
      demoSocialPreview,
      'private',
      null,
      new Request('http://localhost/a/demo/', {
        headers: { Host: 'localhost' },
      }),
    );

    expect(html).toContain('src="http://localhost:55162/a/demo/index.html?_raw"');
    expect(html).not.toContain('shareoutcdn.site');
  });
});
