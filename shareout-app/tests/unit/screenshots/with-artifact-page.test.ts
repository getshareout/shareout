import { afterEach, describe, expect, it, vi } from 'vitest';

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('@cloudflare/puppeteer', () => ({ default: { launch } }));
vi.mock('../../../src/workspaces/usage-ledger', () => ({ recordBrowserSince: vi.fn(async () => {}) }));

import { withArtifactPage } from '../../../src/screenshots';
import { CAPTURE_TTL_SEC } from '../../../src/auth/capture-session';
import type { AccessTokenPayload } from '../../../src/token';
import type { Env } from '../../../src/types';

type Handler = (arg: unknown) => void;
interface FakeTraffic {
  requests?: string[];
  responses?: Array<{ url: string; ip: string; port: number }>;
}

function fakeRequest(url: string) {
  return {
    url: () => url,
    headers: () => ({}) as Record<string, string>,
    isInterceptResolutionHandled: () => false,
    continue: vi.fn(async (_overrides?: { headers?: Record<string, string> }) => {}),
    abort: vi.fn(async () => {}),
  };
}

function fakeBrowser(traffic: FakeTraffic = {}) {
  const handlers: Record<string, Handler[]> = {};
  const emit = (event: string, arg: unknown) => (handlers[event] ?? []).forEach((h) => h(arg));
  const sent: ReturnType<typeof fakeRequest>[] = [];
  const page = {
    setViewport: vi.fn(async () => {}),
    setBypassServiceWorker: vi.fn(async () => {}),
    setRequestInterception: vi.fn(async () => {}),
    on: vi.fn((event: string, handler: Handler) => {
      (handlers[event] ??= []).push(handler);
      return page;
    }),
    // The page's own traffic happens while it loads.
    goto: vi.fn(async () => {
      for (const url of traffic.requests ?? []) {
        const req = fakeRequest(url);
        sent.push(req);
        emit('request', req);
      }
      for (const r of traffic.responses ?? []) emit('response', { url: () => r.url, remoteAddress: () => ({ ip: r.ip, port: r.port }) });
      return null;
    }),
    waitForFunction: vi.fn(async () => {}),
    waitForNetworkIdle: vi.fn(async () => {}),
    evaluate: vi.fn(async () => undefined),
  };
  const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  launch.mockResolvedValue(browser);
  return { page, sent };
}

const env = {
  BROWSER: {},
  SESSION_SECRET: 'session-secret',
  SHAREOUT_BASE_URL: 'https://shareout.example',
  DB: {
    prepare: () => ({
      bind: () => ({ first: async () => ({ slug: 'demo', owner_id: 'usr_1', auth_method: null, owner_email: 'owner@example.com' }) }),
    }),
  },
} as unknown as Env;

const VIEWPORT = { width: 1200, height: 750 };
const FAST = { idleTimeout: 1, settleMs: 0 };
const PAGE = { url: 'https://shareout.example/a/demo/', ip: '104.16.1.1', port: 443 };

afterEach(() => {
  launch.mockReset();
});

describe('withArtifactPage', () => {
  it('opens the page with a capture link that lives one capture window, under the request policy', async () => {
    const { page } = fakeBrowser({ responses: [PAGE] });
    const before = Math.floor(Date.now() / 1000);

    const out = await withArtifactPage(env, 'art_1', VIEWPORT, FAST, async () => 'shot');

    expect(out).toBe('shot');
    const url = new URL(page.goto.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://shareout.example/a/demo/');
    const link = JSON.parse(atob(url.searchParams.get('_capture')!.split('.')[0])) as AccessTokenPayload;
    expect(link).toMatchObject({ artifactId: 'art_1', authType: 'capture' });
    expect(link.exp).toBeGreaterThanOrEqual(before + CAPTURE_TTL_SEC);
    expect(link.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + CAPTURE_TTL_SEC);
    // The policy is in place before the page loads.
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(page.setRequestInterception.mock.invocationCallOrder[0]).toBeLessThan(page.goto.mock.invocationCallOrder[0]);
  });

  it("attaches a read-only session to the page's data requests; the page itself never holds it", async () => {
    const { page, sent } = fakeBrowser({
      requests: ['https://shareout.example/v1/data/art_1/workspace/tables/leads/query', 'https://cdn.jsdelivr.net/npm/x@1/x.js'],
      responses: [PAGE],
    });

    await withArtifactPage(env, 'art_1', VIEWPORT, FAST, async () => 'shot');

    const auth = sent[0].continue.mock.calls[0][0]?.headers?.authorization ?? '';
    expect(auth).toMatch(/^Bearer /);
    const token = auth.slice(7);
    const session = JSON.parse(atob(token.split('.')[0])) as AccessTokenPayload;
    expect(session).toMatchObject({ artifactId: 'art_1', authType: 'owner_test' });
    expect(session).not.toHaveProperty('email');
    const link = new URL(page.goto.mock.calls[0][0] as string).searchParams.get('_capture')!;
    expect(session.exp).toBeLessThanOrEqual((JSON.parse(atob(link.split('.')[0])) as AccessTokenPayload).exp);
    expect(page.goto.mock.calls[0][0]).not.toContain(token);
    expect(sent[1].continue).toHaveBeenCalledWith();
  });

  it('aborts private-network requests the page makes and lets public ones through', async () => {
    const { sent } = fakeBrowser({
      requests: ['http://169.254.169.254/latest/meta-data/', 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.js'],
      responses: [PAGE],
    });

    await withArtifactPage(env, 'art_1', VIEWPORT, FAST, async () => 'shot');

    expect(sent[0].abort).toHaveBeenCalledWith('blockedbyclient');
    expect(sent[1].continue).toHaveBeenCalled();
  });

  it('withholds the capture when a response came from a private address', async () => {
    fakeBrowser({ responses: [PAGE, { url: 'https://inward.example.net/rows.json', ip: '10.0.0.7', port: 443 }] });
    const capture = vi.fn(async () => 'shot');

    const out = await withArtifactPage(env, 'art_1', VIEWPORT, FAST, capture);

    expect(out).toBeNull();
  });
});
