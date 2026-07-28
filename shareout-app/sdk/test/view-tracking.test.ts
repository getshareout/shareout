import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareOut } from '../src/index';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const META = { id: 'pres_1', name: 'Deck', slideCount: 2, createdAt: 't', updatedAt: 't', theme: 'default' };
const SLIDES = [
  { id: 'slide_1', presentationId: 'pres_1', position: 0, content: '<section>1</section>', hidden: false, locked: false, ownerId: null, overrideBackground: null, overrideFonts: null, overrideTransition: null, createdAt: 't', updatedAt: 't' },
  { id: 'slide_2', presentationId: 'pres_1', position: 1, content: '<section>2</section>', hidden: false, locked: false, ownerId: null, overrideBackground: null, overrideFonts: null, overrideTransition: null, createdAt: 't', updatedAt: 't' },
];

interface Call { url: string; method: string; body: any }

function setup(opts: { href: string }) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (url.endsWith('/slides/pres_1')) return jsonResponse({ success: true, data: { slides: SLIDES, ...META } });
    if (url.includes('/links/lnk_x') && url.endsWith('/lnk_x')) return jsonResponse({ success: true, data: { gate: 'none', recipientLabel: 'Acme', revoked: false, expired: false } });
    if (url.includes('/links/lnk_x/access')) return jsonResponse({ success: true, data: { sessionId: 'ses_attributed', granted: true, recipientLabel: 'Acme' } });
    if (url.includes('/analytics/beat')) return jsonResponse({ success: true, data: { sessionId: 'ses_attributed' } });
    return jsonResponse({ success: true, data: {} });
  });

  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { location: { href: opts.href }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { visibilityState: 'visible', getElementById: () => null, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('navigator', { sendBeacon: vi.fn() });
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('view() auto-tracking', () => {
  it('starts a heartbeat automatically on a plain deck view', async () => {
    const { calls } = setup({ href: 'https://shareout.site/p/deck' });
    const sdk = new ShareOut({ artifactId: 'art_1', baseUrl: 'https://shareout.site', batchDelay: 0 });
    const deck = await sdk.slides.view('pres_1');
    await new Promise((r) => setTimeout(r, 0));

    const beats = calls.filter((c) => c.url.includes('/analytics/beat'));
    expect(beats.length).toBeGreaterThanOrEqual(1);
    expect(beats[0].body.totalSlides).toBe(2);
    deck.destroy();
  });

  it('auto-attributes the session when an open tracked link is present', async () => {
    const { calls } = setup({ href: 'https://shareout.site/p/deck?l=lnk_x' });
    const sdk = new ShareOut({ artifactId: 'art_1', baseUrl: 'https://shareout.site', batchDelay: 0 });
    const deck = await sdk.slides.view('pres_1');
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.some((c) => c.url.includes('/links/lnk_x/access') && c.method === 'POST')).toBe(true);
    const beats = calls.filter((c) => c.url.includes('/analytics/beat'));
    expect(beats[0].body.sessionId).toBe('ses_attributed');
    deck.destroy();
  });

  it('does not track when track:false', async () => {
    const { calls } = setup({ href: 'https://shareout.site/p/deck?l=lnk_x' });
    const sdk = new ShareOut({ artifactId: 'art_1', baseUrl: 'https://shareout.site', batchDelay: 0 });
    const deck = await sdk.slides.view('pres_1', { track: false });
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.some((c) => c.url.includes('/analytics/beat'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/links/lnk_x/access'))).toBe(false);
    deck.destroy();
  });

  it('trackSlide forwards the slide id to the tracker', async () => {
    const { calls } = setup({ href: 'https://shareout.site/p/deck' });
    const sdk = new ShareOut({ artifactId: 'art_1', baseUrl: 'https://shareout.site', batchDelay: 0 });
    const deck = await sdk.slides.view('pres_1');
    await new Promise((r) => setTimeout(r, 0));
    calls.length = 0;
    deck.trackSlide(1);
    await new Promise((r) => setTimeout(r, 0));

    const beats = calls.filter((c) => c.url.includes('/analytics/beat'));
    expect(beats.some((b) => b.body.slideIndex === 1 && b.body.slideId === 'slide_2')).toBe(true);
    deck.destroy();
  });
});
