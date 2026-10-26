// The shared-link viewer ships the Data pill + panel to every viewer — including people
// with no account and no toolbar — except where ShareOut chrome is off (Studio stage,
// owner-hidden toolbar).
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
const viewerConfig = vi.hoisted(() => ({ getViewerConfig: vi.fn() }));

vi.mock('../../../src/serve/prefetch', () => prefetchMocks);
vi.mock('../../../src/data/viewer-config', () => viewerConfig);
vi.mock('../../../src/analytics', () => ({ trackPageView: vi.fn(async () => undefined) }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser: vi.fn(async () => null),
}));
vi.mock('../../../src/view-tracking', () => ({ trackViewerView: vi.fn(async () => undefined) }));
vi.mock('../../../src/scheduling/events', () => ({ maybeEmitViewEvent: vi.fn(async () => undefined) }));

const env = {
  DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn(async () => null), all: vi.fn(async () => ({ results: [] })) })) })) },
  ARTIFACTS: { get: vi.fn() },
  SHAREOUT_BASE_URL: 'https://shareout.example.com',
  SESSION_SECRET: 'test-secret',
} as unknown as Env;

async function render(opts: { url?: string; manifest?: string | null; lang?: string; page?: string } = {}): Promise<string> {
  const request = new Request(opts.url ?? 'https://shareout.example.com/a/demo/', { headers: { 'Accept-Language': opts.lang ?? 'en-US' } });
  const res = await serveSandboxedViewer(
    request, env, 'demo', opts.page ?? 'index.html', 'ver_1', 'art_ds1', null, 'public', null, opts.manifest ?? null, null, null,
  );
  return res.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  prefetchMocks.fetchInitialJsonData.mockResolvedValue(null);
  prefetchMocks.fetchInitialTableData.mockResolvedValue(null);
  prefetchMocks.detectAdminStatus.mockResolvedValue(null);
  prefetchMocks.detectFavoriteState.mockResolvedValue({ loggedIn: false, isFavorite: false });
  prefetchMocks.detectCommentsState.mockResolvedValue({ loggedIn: false, enabled: false, count: 0, identityMode: 'anonymous' });
  prefetchMocks.fetchAttachedSkills.mockResolvedValue([]);
  viewerConfig.getViewerConfig.mockResolvedValue({ hide_toolbar: false, show_on_mobile: false });
});

describe('Data sources in the shared-link viewer', () => {
  it('gives an anonymous viewer (no toolbar) the pill, hidden until the page says it shows data', async () => {
    const html = await render();
    expect(html).not.toContain('id="shareout-admin-toolbar"');
    expect(html).toMatch(/<button type="button" id="so-ds-pill" class="so-ds-pill" hidden aria-haspopup="dialog"/);
    expect(html).toContain('id="so-ds-panel" role="dialog" aria-modal="false" aria-labelledby="so-ds-title" hidden');
    // No toolbar means no token stylesheet: the panel ships its own.
    expect(html).toContain('--color-primary:');
    expect(html).toContain('"id":"art_ds1","page":"index.html"');
    expect(html).toContain('"visible":false');
  });

  it('asks for the page actually shown on multi-page sites, in the viewer\'s language', async () => {
    const html = await render({ page: 'pages/ventas.html', lang: 'es-AR' });
    expect(html).toContain('"page":"pages/ventas.html"');
    expect(html).toContain('<span>Datos</span>');
    expect(html).toContain('Fuentes de datos');
  });

  it('shows the pill at once on pages that declare live MCP connections', async () => {
    const html = await render({ manifest: JSON.stringify({ capabilities: { mcp: { connections: [{ name: 'hub', tools: ['x'] }] } } }) });
    expect(html).toContain('"visible":true');
  });

  it('stays out of the Studio stage and of pages whose owner hid the ShareOut toolbar', async () => {
    expect(await render({ url: 'https://shareout.example.com/a/demo/?wsx=1' })).not.toContain('so-ds-pill');
    viewerConfig.getViewerConfig.mockResolvedValue({ hide_toolbar: true, show_on_mobile: false });
    expect(await render()).not.toContain('so-ds-pill');
  });
});
