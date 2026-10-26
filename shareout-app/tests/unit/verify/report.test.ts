import { describe, expect, it } from 'vitest';
import { agentSummary, buildResult, type ReportInput } from '../../../src/verify/report';
import { displayUrl, scrub } from '../../../src/verify/run';
import type { PageSignals, Viewport, VerifyIssue } from '../../../src/verify/types';

function page(viewport: Viewport, over: Partial<PageSignals> = {}): PageSignals {
  return {
    viewport,
    loadMs: 120,
    pageErrors: [],
    console: [],
    requests: [],
    blocked: [],
    dialogs: [],
    storage: [],
    popups: 0,
    layout: {
      viewportWidth: viewport === 'desktop' ? 1280 : 390,
      scrollWidth: viewport === 'desktop' ? 1280 : 390,
      overflow: [],
      smallTargets: { count: 0, examples: [] },
      brokenImages: [],
      textLength: 200,
      visibleMedia: 1,
      readyFlag: null,
    },
    design: null,
    axe: viewport === 'desktop' ? { violations: [] } : null,
    metrics: { lcpMs: 900, cls: 0, bytes: 40_000, requests: 4 },
    screenshot: null,
    ...over,
  };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    id: 'vfy_1',
    artifactId: 'art_1',
    versionNo: 3,
    versionId: 'ver_3',
    live: true,
    signals: [page('desktop'), page('mobile')],
    sourceIssues: [],
    screenshots: {
      desktop: { path: '/v1/artifacts/art_1/verify/vfy_1/desktop.webp', width: 800, height: 500, full_page: false },
      mobile: { path: '/v1/artifacts/art_1/verify/vfy_1/mobile.webp', width: 780, height: 1688, full_page: false },
    },
    thumbnailRefreshed: true,
    isPublic: true,
    lockCsp: false,
    startedAt: 1000,
    now: 9000,
    ...over,
  };
}

const rule = (issues: VerifyIssue[], id: string) => issues.find((i) => i.rule === id);

describe('buildResult', () => {
  it('a clean page passes with both screenshots', () => {
    const r = buildResult(input());
    expect(r.status).toBe('pass');
    expect(r.summary).toBe('pass — no problems found');
    expect(r.issues).toEqual([]);
    expect(r.viewports.map((v) => [v.viewport, v.width, v.height, v.dpr, v.screenshot?.width])).toEqual([
      ['desktop', 1280, 800, 1, 800],
      ['mobile', 390, 844, 2, 780],
    ]);
    expect(r.duration_ms).toBe(8000);
  });

  it('an uncaught error on load fails with its message and line, merged across viewports', () => {
    const err = { message: "TypeError: Cannot set properties of null (setting 'textContent')", where: 'index.html:8:58', count: 1 };
    const r = buildResult(input({ signals: [page('desktop', { pageErrors: [err] }), page('mobile', { pageErrors: [err] })] }));
    expect(r.status).toBe('fail');
    expect(r.issues).toEqual([expect.objectContaining({
      rule: 'js_error',
      severity: 'error',
      message: "Uncaught TypeError: Cannot set properties of null (setting 'textContent')",
      where: 'index.html:8:58',
      viewports: ['desktop', 'mobile'],
    })]);
  });

  it('localStorage in the viewer sandbox reports a SecurityError with the fix', () => {
    const err = { message: "DOMException: Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.", where: 'index.html:7:17', count: 1 };
    const issue = rule(buildResult(input({ signals: [page('desktop', { pageErrors: [err], storage: ['localStorage'] })] })).issues, 'storage_blocked');
    expect(issue).toMatchObject({ severity: 'error', where: 'index.html:7:17' });
    expect(issue!.message).toMatch(/^Uncaught SecurityError: Failed to read the 'localStorage' property/);
    expect(issue!.hint).toContain('sdk.json');
  });

  it('an uncaught IndexedDB denial is reported once, as an error', () => {
    const err = { message: "DOMException: Failed to execute 'open' on 'IDBFactory': access to the Indexed Database API is denied in this context.", where: 'app.js:2:5', count: 1 };
    const issues = buildResult(input({ signals: [page('desktop', { pageErrors: [err], storage: ['indexedDB'] })] })).issues;
    expect(issues.filter((i) => i.rule === 'storage_blocked').map((i) => i.severity)).toEqual(['error']);
  });

  it('a caught storage denial is still a warning (nothing persists)', () => {
    const issue = rule(buildResult(input({ signals: [page('mobile', { storage: ['sessionStorage'] })] })).issues, 'storage_blocked');
    expect(issue).toMatchObject({ severity: 'warning', viewports: ['mobile'] });
  });

  it('a 1400px table on a phone names the overflowing element', () => {
    const layout = { ...page('mobile').layout!, scrollWidth: 1408, overflow: [{ selector: 'main > table.orders', px: 1018 }] };
    const issue = rule(buildResult(input({ signals: [page('desktop'), page('mobile', { layout })] })).issues, 'horizontal_overflow');
    expect(issue).toMatchObject({ severity: 'error', where: 'main > table.orders', viewports: ['mobile'] });
    expect(issue!.message).toContain('1018px wider than the phone screen (390px)');
  });

  it('a page laid out wider than the phone without a viewport tag gets the meta fix', () => {
    const layout = { ...page('mobile').layout!, viewportWidth: 980, scrollWidth: 980 };
    expect(rule(buildResult(input({ signals: [page('mobile', { layout })] })).issues, 'no_viewport_meta')?.hint).toContain('width=device-width');
  });

  it('axe impacts map to severities (serious and critical are errors)', () => {
    const v = (id: string, impact: 'minor' | 'moderate' | 'serious' | 'critical') =>
      ({ id, impact, help: id, helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}?application=axeAPI`, nodes: 1, targets: ['img'] });
    const r = buildResult(input({ signals: [page('desktop', { axe: { violations: [v('image-alt', 'critical'), v('color-contrast', 'serious'), v('list', 'moderate'), v('x', 'minor')] } })] }));
    expect(['image-alt', 'color-contrast', 'list', 'x'].map((id) => rule(r.issues, id)?.severity)).toEqual(['error', 'error', 'warning', 'info']);
    expect(rule(r.issues, 'image-alt')).toMatchObject({ check: 'a11y', where: 'img', viewports: ['desktop'] });
    expect(rule(r.issues, 'image-alt')!.hint).toBe('How to fix: https://dequeuniversity.com/rules/axe/4.13/image-alt');
  });

  it('expected SDK misses and read-only write refusals are notes, not failures', () => {
    const signals = [page('desktop', {
      requests: [
        { url: '/v1/data/art_1/json/visits', method: 'GET', type: 'fetch', status: 404, code: 'KEY_NOT_FOUND', count: 1 },
        { url: '/v1/data/art_1/json/visits', method: 'PUT', type: 'fetch', status: 403, readOnlySkip: true, count: 1 },
      ],
      console: [{ level: 'error', text: 'save failed This is a read-only test run — writes, emails, and provisioning are disabled.', count: 1 }],
    })];
    const r = buildResult(input({ signals }));
    expect(r.status).toBe('pass');
    expect(r.issues.map((i) => [i.rule, i.severity])).toEqual([['write_skipped', 'info'], ['api_empty_read', 'info']]);
    expect(rule(r.issues, 'write_skipped')!.message).toContain('the page\'s own error handling saw the refusal');
  });

  it('other ShareOut API errors carry the body code and hint', () => {
    const r = buildResult(input({ signals: [page('desktop', {
      requests: [{ url: '/v1/data/art_1/connections/sales/query', method: 'POST', type: 'fetch', status: 404, code: 'CONNECTION_NOT_FOUND', hint: 'Check the connection name.', count: 2 }],
    })] }));
    expect(rule(r.issues, 'api_error')).toMatchObject({ severity: 'error', hint: 'Check the connection name.', count: 2 });
    expect(rule(r.issues, 'api_error')!.message).toBe('POST /v1/data/art_1/connections/sales/query → 404 CONNECTION_NOT_FOUND');
  });

  it('a CDN blocked by the public CSP is an error that says why', () => {
    const blocked = [{ reason: 'csp' as const, url: 'evil-cdn.example.net/lib.js', type: 'script', directive: 'script-src', count: 1 }];
    const issue = rule(buildResult(input({ signals: [page('desktop', { blocked })] })).issues, 'csp_blocked');
    expect(issue).toMatchObject({ severity: 'error' });
    expect(issue!.hint).toContain('CDN allowlist');
  });

  it('without a browser binding the result is partial and keeps the source findings', () => {
    const source: VerifyIssue = { check: 'source', rule: 'absolute_path', severity: 'error', message: 'x', hint: 'Use relative paths' };
    const r = buildResult(input({ signals: null, partialReason: 'no_browser', sourceIssues: [source], screenshots: {}, thumbnailRefreshed: false }));
    expect(r).toMatchObject({ status: 'partial', partial_reason: 'no_browser', viewports: [], counts: { error: 1, warning: 0, info: 0 } });
    expect(r.summary).toContain('source checks only');
  });

  it('when no viewport could be opened the result is partial (render_failed)', () => {
    const r = buildResult(input({ signals: [page('desktop', { renderError: 'Could not open the page: it answered HTTP 403' })], screenshots: {} }));
    expect(r).toMatchObject({ status: 'partial', partial_reason: 'render_failed' });
    expect(rule(r.issues, 'render_failed')!.message).toContain('HTTP 403');
  });
});

describe('agentSummary', () => {
  it('stays within 40 lines however many issues there are', () => {
    const many: VerifyIssue[] = Array.from({ length: 120 }, (_, n) => ({
      check: 'source', rule: `r${n}`, severity: n % 3 ? 'warning' : 'error', message: `problem ${n}`, hint: `fix ${n}`,
    }));
    const r = buildResult(input({ sourceIssues: many }));
    const text = agentSummary(r, 'Sales');
    expect(text.split('\n').length).toBeLessThanOrEqual(40);
    expect(text).toMatch(/^Checked "Sales" v3 \(live\) — FAIL:/);
    expect(text).toContain('more in the full report: GET /v1/artifacts/art_1/verify/latest');
  });

  it('lists errors with their fix and says what to do next', () => {
    const err = { message: 'TypeError: x is undefined', where: 'app.js:3:9', count: 1 };
    const text = agentSummary(buildResult(input({ signals: [page('desktop', { pageErrors: [err] }), page('mobile')] })), 'Sales');
    expect(text).toContain('1. [desktop] Uncaught TypeError: x is undefined — app.js:3:9');
    expect(text).toContain('   → An uncaught exception');
    expect(text).toContain('desktop LCP 0.9 s');
    expect(text.split('\n').at(-1)).toContain('verify again');
  });
});

describe('credential scrubbing', () => {
  const plan = { pageOrigin: 'https://abc.cdn.example', basePath: '/c/ct%3D/', entrypoint: 'index.html', platformOrigin: 'https://shareout.example' };

  it('shows the page\'s files relative to it and never the capture token', () => {
    expect(displayUrl('https://abc.cdn.example/c/ct%3D/?_capture=eyJhbGciOi.c2lnbmF0dXJl', plan)).toBe('index.html');
    expect(displayUrl('https://abc.cdn.example/c/ct%3D/css/site.css', plan)).toBe('css/site.css');
    expect(displayUrl('https://abc.cdn.example/styles.css', plan)).toBe('/styles.css');
    expect(displayUrl('https://shareout.example/v1/data/art_1/json/x?token=abc&limit=5', plan)).toBe('/v1/data/art_1/json/x?token=…&limit=5');
    expect(displayUrl('https://img.example.org/a.png?sig=zz', plan)).toBe('img.example.org/a.png?sig=…');
  });

  it('removes capture tokens, content capabilities and access tokens from page text', () => {
    expect(scrub('at https://x/a/s/?_capture=eyJhYmMiOjF9.c2lnbmF0dXJl&_ver=1 and https://x/c/ey%3D%3D/app.js session=eyJhcnRpZmFjdElkIjoiYXJ0In0.QUJDREVGR0hJSg'))
      .toBe('at https://x/a/s/?_capture=…&_ver=1 and https://x/c/…/app.js session=…');
  });
});
