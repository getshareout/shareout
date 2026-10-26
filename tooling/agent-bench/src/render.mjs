/**
 * Render a published artifact the way a viewer sees it, on Chrome for Testing, at a
 * desktop and a phone viewport. Collects errors, failed requests, axe violations,
 * layout problems, LCP and bytes, and writes screenshots for the judge.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appModule, appResolve, assertChromeForTesting, ensureDir, log, sleep } from './lib.mjs';

export const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true, deviceScaleFactor: 2, hasTouch: true },
];

const AXE_VERSION = '4.10.2';

const INIT_SCRIPT = `(() => {
  window.__bench = { errors: [], lcp: 0 };
  addEventListener('error', (e) => window.__bench.errors.push(String(e.message || e.error || 'error')));
  addEventListener('unhandledrejection', (e) => window.__bench.errors.push('unhandledrejection: ' + String(e.reason && (e.reason.message || e.reason))));
  try {
    new PerformanceObserver((l) => { for (const en of l.getEntries()) window.__bench.lcp = Math.max(window.__bench.lcp, en.startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
})();`;

export async function launchBrowser() {
  const { chromium } = appModule('playwright-core');
  return chromium.launch({ executablePath: assertChromeForTesting(), headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
}

export async function newViewerContext(browser, inst, vp = VIEWPORTS[0]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: !!vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    locale: 'en-US',
  });
  const [name, ...rest] = inst.cookie.split('=');
  await ctx.addCookies([{ name, value: rest.join('='), domain: 'localhost', path: '/' }]);
  await ctx.addInitScript(INIT_SCRIPT);
  return ctx;
}

/** The artifact's own document: the sandboxed iframe inside the viewer shell. */
export async function contentFrame(page, slug, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const f = page.frames().find((fr) => fr !== page.mainFrame() && fr.url().includes(`/a/${slug}/`));
    if (f) {
      try {
        await f.waitForLoadState('load', { timeout: Math.max(1000, deadline - Date.now()) });
        return f;
      } catch {}
    }
    await sleep(200);
  }
  return page.mainFrame();
}

export async function openArtifact(page, inst, slug, { path = '', settleMs = 2500 } = {}) {
  await page.goto(`${inst.origin}/a/${slug}/${path}`, { waitUntil: 'load', timeout: 45_000 });
  const frame = await contentFrame(page, slug);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await sleep(settleMs);
  return frame;
}

let axeSource;
async function loadAxe(inst) {
  if (axeSource) return axeSource;
  try {
    const r = await fetch(`${inst.origin}/vendor/axe-core@${AXE_VERSION}/axe.min.js`);
    if (r.ok) axeSource = await r.text();
  } catch {}
  if (!axeSource) {
    try {
      axeSource = readFileSync(appResolve('axe-core/axe.min.js'), 'utf8');
    } catch {}
  }
  return axeSource;
}

const LAYOUT_PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const overflowX = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - vw;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const interactive = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[onclick]')].filter(visible);
  const smallTargets = interactive.filter((el) => { const r = el.getBoundingClientRect(); return (r.width < 24 || r.height < 24) && !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'); });
  const clipped = [...document.querySelectorAll('body *')].filter((el) => {
    if (!visible(el) || !el.childNodes.length) return false;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasText) return false;
    const s = getComputedStyle(el);
    const hides = /hidden|clip/.test(s.overflowX + s.overflowY);
    return hides && s.textOverflow !== 'ellipsis' && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 4) && !/-webkit-box/.test(s.display);
  });
  const offscreen = [...document.querySelectorAll('body *')].filter((el) => { if (!visible(el)) return false; const r = el.getBoundingClientRect(); return r.right > vw + 4 && r.left < vw && getComputedStyle(el).position !== 'fixed'; }).length;
  const text = (document.body && document.body.innerText || '').trim();
  const media = [...document.querySelectorAll('canvas,svg,img,video,iframe')].filter((el) => { const r = el.getBoundingClientRect(); return r.width * r.height > 5000; }).length;
  const fontSizes = new Set([...document.querySelectorAll('body *')].filter(visible).slice(0, 2000).map((el) => getComputedStyle(el).fontSize));
  return {
    overflow_x_px: Math.max(0, overflowX),
    small_tap_targets: smallTargets.length,
    small_tap_examples: smallTargets.slice(0, 5).map((el) => (el.innerText || el.getAttribute('aria-label') || el.tagName).slice(0, 40)),
    interactive: interactive.length,
    clipped_text: clipped.length,
    clipped_examples: clipped.slice(0, 5).map((el) => el.innerText.slice(0, 40)),
    offscreen_elements: offscreen,
    text_chars: text.length,
    media,
    distinct_font_sizes: fontSizes.size,
    scroll_height: document.documentElement.scrollHeight,
    lang: document.documentElement.lang || null,
    title: document.title || null,
    bench_errors: (window.__bench && window.__bench.errors) || [],
    lcp_ms: (window.__bench && window.__bench.lcp) || null,
  };
})()`;

export async function renderArtifact(browser, inst, artifact, outDir) {
  ensureDir(outDir);
  const results = {};
  const axe = await loadAxe(inst);
  for (const vp of VIEWPORTS) {
    const ctx = await newViewerContext(browser, inst, vp);
    const page = await ctx.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const failed = [];
    let bytes = 0;
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e).slice(0, 300)));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('requestfailed', (r) => {
      const err = r.failure()?.errorText || 'failed';
      if (!/ERR_ABORTED/.test(err)) failed.push(`${r.method()} ${r.url().slice(0, 160)} ${err}`);
    });
    page.on('response', async (r) => {
      if (r.status() >= 400 && !/favicon/.test(r.url())) failed.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`);
      try {
        const s = await r.request().sizes();
        bytes += s.responseBodySize + s.responseHeadersSize;
      } catch {}
    });

    const started = Date.now();
    let frame;
    let navError = null;
    try {
      frame = await openArtifact(page, inst, artifact.slug);
    } catch (e) {
      navError = String(e.message || e).slice(0, 300);
    }
    const loadMs = Date.now() - started;
    let probe = null;
    let a11y = null;
    if (frame) {
      probe = await frame.evaluate(LAYOUT_PROBE).catch((e) => ({ error: String(e.message || e) }));
      if (axe) {
        a11y = await frame
          .evaluate(`${axe}\n;axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })))`)
          .catch((e) => ({ error: String(e.message || e).slice(0, 300) }));
      }
    }
    const shot = join(outDir, `${vp.name}.png`);
    const fullShot = join(outDir, `${vp.name}-full.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    const h = Math.min(Math.max(probe?.scroll_height || vp.height, vp.height), vp.name === 'mobile' ? 3200 : 2400);
    if (h > vp.height + 40) {
      await page.setViewportSize({ width: vp.width, height: h });
      await sleep(600);
      await page.screenshot({ path: fullShot }).catch(() => {});
    }
    const norm = (t) => t.replace(/^unhandledrejection: /, '').replace(/^Uncaught (\w*Error: )?/, '');
    const seen = new Set();
    const allPageErrors = [...pageErrors, ...(probe?.bench_errors || [])].filter((t) => !seen.has(norm(t)) && seen.add(norm(t)));
    const blank = !probe || probe.error || (probe.text_chars < 20 && probe.media === 0);
    results[vp.name] = {
      nav_error: navError,
      load_ms: loadMs,
      page_errors: allPageErrors,
      console_errors: consoleErrors.filter((t) => !allPageErrors.some((p) => t.includes(p))),
      failed_requests: [...new Set(failed)],
      bytes,
      probe,
      a11y,
      blank: !!blank,
      screenshot: shot,
      screenshot_full: h > vp.height + 40 ? fullShot : null,
    };
    await ctx.close();
    log(`render ${artifact.slug} ${vp.name}: ${blank ? 'BLANK ' : ''}${allPageErrors.length} errors, ${Array.isArray(a11y) ? a11y.length : '?'} axe rules`);
  }
  return { ...results, scores: scoreRender(results) };
}

const IMPACT = { critical: 0.25, serious: 0.12, moderate: 0.05, minor: 0.02 };

export function scoreRender(r) {
  const vps = VIEWPORTS.map((v) => r[v.name]).filter(Boolean);
  const runtime = Math.min(
    ...vps.map((x) => {
      let s = 1 - 0.3 * x.page_errors.length - 0.1 * x.console_errors.length - 0.1 * x.failed_requests.length;
      const lcp = x.probe?.lcp_ms;
      if (lcp > 4000) s -= 0.3;
      else if (lcp > 2500) s -= 0.15;
      return Math.max(0, s);
    })
  );
  const a11y = Math.min(
    ...vps.map((x) => {
      if (!Array.isArray(x.a11y)) return 0.5;
      const pen = x.a11y.reduce((acc, v) => acc + (IMPACT[v.impact] || 0.02), 0);
      return Math.max(0, 1 - pen);
    })
  );
  const layout =
    vps.reduce((acc, x) => {
      const p = x.probe || {};
      if (p.error || !p.text_chars) return acc;
      let s = 1;
      if (p.overflow_x_px > 4) s -= 0.4;
      s -= Math.min(0.3, 0.05 * (p.clipped_text || 0));
      s -= Math.min(0.2, 0.04 * (p.offscreen_elements > 0 ? Math.min(p.offscreen_elements, 5) : 0));
      if (x === r.mobile) s -= Math.min(0.2, 0.02 * (p.small_tap_targets || 0));
      return acc + Math.max(0, s);
    }, 0) / Math.max(1, vps.length);
  const gates = {
    not_blank: vps.every((x) => !x.blank),
    no_uncaught_errors: vps.every((x) => x.page_errors.length === 0),
  };
  return { runtime, a11y, layout, gates };
}
