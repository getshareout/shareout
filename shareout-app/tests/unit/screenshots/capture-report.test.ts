// Report emails attach the PDF captureArtifactReport prints. With no paper format it is
// one continuous page of the screen layout, with any `@page` size the page declares
// overridden; with one it is paginated with the page's own print CSS, letting a `@page`
// rule set size and margins.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('@cloudflare/puppeteer', () => ({ default: { launch } }));
vi.mock('../../../src/workspaces/usage-ledger', () => ({ recordBrowserSince: vi.fn(async () => {}) }));

import { captureArtifactReport } from '../../../src/screenshots';
import type { Env } from '../../../src/types';

const DIMS = { w: 1400, h: 3000 };
const EXPORT = { emailSubject: 'Monthly report', csv: 'Month,Total\nJan,1' };

function fakePage() {
  const page = {
    setViewport: vi.fn(async () => {}),
    setBypassServiceWorker: vi.fn(async () => {}),
    setRequestInterception: vi.fn(async () => {}),
    on: vi.fn(() => page),
    goto: vi.fn(async () => null),
    waitForFunction: vi.fn(async () => {}),
    waitForNetworkIdle: vi.fn(async () => {}),
    // The __shareoutExport read gets the page's export; every other evaluate (fonts,
    // flattening, measuring) gets the content size.
    evaluate: vi.fn(async (fn: unknown) => (String(fn).includes('__shareoutExport') ? EXPORT : DIMS)),
    emulateMediaType: vi.fn(async () => {}),
    addStyleTag: vi.fn(async () => ({})),
    pdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  };
  launch.mockResolvedValue({ newPage: vi.fn(async () => page), close: vi.fn(async () => {}) });
  return page;
}

const env = {
  BROWSER: {},
  SESSION_SECRET: 'session-secret',
  SHAREOUT_BASE_URL: 'https://shareout.example',
  DB: {
    prepare: () => ({
      bind: () => ({ first: async () => ({ slug: 'monthly', owner_id: 'usr_1', auth_method: null, owner_email: 'owner@example.com' }) }),
    }),
  },
} as unknown as Env;

const FAST = { idleTimeout: 1, settleMs: 0 };

afterEach(() => {
  launch.mockReset();
});

describe('captureArtifactReport', () => {
  it('prints one continuous screen-media page sized to the content by default', async () => {
    const page = fakePage();

    const out = await captureArtifactReport(env, 'art_1', FAST);

    expect(out.data).toEqual(EXPORT);
    expect(out.pdf).not.toBeNull();
    expect(page.emulateMediaType).toHaveBeenCalledWith('screen');
    expect(page.emulateMediaType).not.toHaveBeenCalledWith('print');
    expect(page.pdf).toHaveBeenCalledWith({
      printBackground: true,
      width: '1400px',
      height: '3000px',
      pageRanges: '1',
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
  });

  it("overrides the page's own @page size with the content size before printing", async () => {
    const page = fakePage();

    await captureArtifactReport(env, 'art_1', FAST);

    expect(page.addStyleTag).toHaveBeenCalledWith({
      content: '@page { size: 1400px 3000px !important; margin: 0 !important; }',
    });
    expect(page.addStyleTag.mock.invocationCallOrder[0]).toBeLessThan(page.pdf.mock.invocationCallOrder[0]);
  });

  it('paginates at the paper size with print media, deferring to the page @page rule', async () => {
    const page = fakePage();

    const out = await captureArtifactReport(env, 'art_1', { ...FAST, format: 'A4' });

    expect(out.data).toEqual(EXPORT);
    expect(page.emulateMediaType).toHaveBeenCalledWith('print');
    expect(page.emulateMediaType).not.toHaveBeenCalledWith('screen');
    // Here the page's own @page must win, so nothing overrides it.
    expect(page.addStyleTag).not.toHaveBeenCalled();
    expect(page.pdf).toHaveBeenCalledWith({
      printBackground: true,
      format: 'A4',
      landscape: false,
      preferCSSPageSize: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    // The export is read before the page switches to print media.
    const exportRead = page.evaluate.mock.calls.findIndex(([fn]) => String(fn).includes('__shareoutExport'));
    expect(page.evaluate.mock.invocationCallOrder[exportRead]).toBeLessThan(page.emulateMediaType.mock.invocationCallOrder[0]);
  });

  it('prints landscape when asked', async () => {
    const page = fakePage();

    await captureArtifactReport(env, 'art_1', { ...FAST, format: 'Letter', landscape: true });

    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({ format: 'Letter', landscape: true }));
  });
});
