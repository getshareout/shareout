import puppeteer from '@cloudflare/puppeteer';
import type { Env } from './types';
import { createAccessToken } from './token';
import { getPlatformOrigin } from './config/origins';
import { setPresentation } from './artifacts/satellites';

const THUMB_WIDTH = 1200;
const THUMB_HEIGHT = 750;
// Small grid cards render the preview in a ~280px box. Re-rasterizing the same
// 1200×750 layout at this device scale yields a ~720×450 image sized for that box,
// so the browser barely downscales it — far crisper than squashing the 2400px
// full preview ~4× in a single step (which softens text and thin chart lines).
const CARD_SCALE = 0.6;
const NAV_TIMEOUT = 20000;

interface WaitOptions {
  /** Max time (ms) to wait for in-flight requests (e.g. BigQuery) to settle. */
  idleTimeout?: number;
  /** Extra fixed settle delay (ms) after network idle, for chart paint. */
  settleMs?: number;
}

export interface RenderOptions extends WaitOptions {
  width?: number;
  height?: number;
  type?: 'webp' | 'png' | 'jpeg';
  quality?: number;
  /** Capture the full scroll height instead of clipping to the viewport. */
  fullPage?: boolean;
}

export interface PdfOptions extends WaitOptions {
  width?: number;
  height?: number;
  format?: string;
  landscape?: boolean;
}

/**
 * Open an artifact's production page in headless Chromium, wait for its data to
 * load and paint, then hand the live page to `capture`. Mints short-lived owner
 * credentials so private artifacts render real content instead of the login
 * wall. Returns null when there's no production deployment, BROWSER is unbound,
 * or rendering fails.
 *
 * Data-heavy artifacts (e.g. BigQuery-backed dashboards) can set
 * `window.__shareoutReady = true` once their data has rendered; the renderer
 * waits for that flag before capturing. Absent the flag it falls back to a
 * network-idle heuristic that tolerates the persistent realtime socket.
 */
export async function withArtifactPage<T>(
  env: Env,
  artifactId: string,
  viewport: { width: number; height: number },
  waits: WaitOptions,
  capture: (page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>) => Promise<T>,
  // versionId: pin a specific (candidate) version to render instead of the live
  //   deployment — used by Artifact Tests BLOCK-mode gating.
  // beforeNavigate: hook run after the page is created and BEFORE navigation, so a
  //   caller can attach pageerror/console listeners that catch load-time errors
  //   (the capture callback runs post-navigation, too late for that). T1 smoke.
  opts: {
    versionId?: string;
    beforeNavigate?: (page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>) => void;
  } = {}
): Promise<T | null> {
  if (!env.BROWSER) return null;

  const dep = await env.DB.prepare(
    `SELECT d.slug AS slug, a.owner_id AS owner_id, a.auth_method AS auth_method, u.email AS owner_email
       FROM deployments d
       JOIN artifacts a ON a.id = d.artifact_id
       LEFT JOIN users u ON u.id = a.owner_id
      WHERE d.artifact_id = ? AND d.channel = 'production'`
  ).bind(artifactId).first<{ slug: string; owner_id: string | null; auth_method: string | null; owner_email: string | null }>();
  if (!dep?.slug) return null;

  const base = getPlatformOrigin(env);
  // Render the dedicated capture view: the bare artifact HTML at top-level (no
  // sandbox iframe, no toolbar), authorized by a short-lived signed token and served
  // with an injected READ-ONLY owner session (owner_test) so its data calls
  // authenticate for reads but can never mutate. This is the only way full-height
  // capture works — the normal viewer nests the dashboard in a fixed-height,
  // cross-origin iframe we can't reach into.
  const captureToken = await createAccessToken(artifactId, 'capture', env, 300);
  const verPin = opts.versionId ? `&_ver=${encodeURIComponent(opts.versionId)}` : '';
  const url = `${base}/a/${dep.slug}/?_capture=${encodeURIComponent(captureToken)}${verPin}`;

  const idleTimeout = waits.idleTimeout ?? 8000;
  const settleMs = waits.settleMs ?? 1200;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(env.BROWSER as Parameters<typeof puppeteer.launch>[0]);
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
    if (opts.beforeNavigate) opts.beforeNavigate(page);
    await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });

    // Preferred signal: the artifact tells us its data has rendered.
    await page.waitForFunction('window.__shareoutReady === true', { timeout: idleTimeout }).catch(() => {});
    // Fallback: wait for data requests (BigQuery etc.) to finish. concurrency:2
    // tolerates the persistent realtime/comments socket that would otherwise
    // keep the page from ever going "idle".
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: idleTimeout, concurrency: 2 }).catch(() => {});
    await page.evaluate(() =>
      (globalThis as any).document?.fonts?.ready ?? Promise.resolve()
    ).catch(() => {});
    await new Promise((r) => setTimeout(r, settleMs));

    return await capture(page);
  } catch (err) {
    console.error('withArtifactPage failed', { artifactId, url, error_stack: (err as Error)?.stack || String(err) });
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

type RenderPage = Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>;

// Runs in the browser: flatten internal scroll containers (app shells often
// wrap content in an overflow:auto div of fixed/viewport height, so the document
// itself never scrolls and reports only the first screen). Forcing them to
// natural height makes document.scrollHeight reflect the full content.
function flattenScrollers() {
  const g: any = globalThis;
  const doc = g.document;
  if (!doc) return;
  const els: any[] = Array.prototype.slice.call(doc.querySelectorAll('*'));
  for (const el of els) {
    if (!el || !el.style) continue;
    const cs = g.getComputedStyle(el);
    const scrolls = /(auto|scroll)/.test(cs.overflowY || '') || /(auto|scroll)/.test(cs.overflow || '');
    if (scrolls && el.scrollHeight > el.clientHeight + 4) {
      el.style.height = 'auto';
      el.style.maxHeight = 'none';
      el.style.overflow = 'visible';
    }
  }
  for (const el of [doc.documentElement, doc.body]) {
    if (el && el.style) {
      el.style.height = 'auto';
      el.style.maxHeight = 'none';
      el.style.overflow = 'visible';
    }
  }
}

// Flatten inner scrollers, grow the viewport to the page's full content size,
// and return those dims. A normal (viewport) screenshot/PDF then captures the
// whole page — the `fullPage: true` screenshot path renders blank in Workers'
// headless Chromium for viewport-height app layouts, whereas this matches the
// working PDF path.
async function growToContent(page: RenderPage, maxW = 2000, maxH = 18000): Promise<{ w: number; h: number }> {
  const measure = () => page.evaluate(() => {
    const d = (globalThis as any).document.documentElement;
    const b = (globalThis as any).document.body;
    return {
      w: Math.max(d.scrollWidth, b ? b.scrollWidth : 0, d.clientWidth),
      h: Math.max(d.scrollHeight, b ? b.scrollHeight : 0),
    };
  }) as Promise<{ w: number; h: number }>;

  await page.evaluate(flattenScrollers).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));

  let dims = await measure().catch(() => ({ w: 0, h: 0 }));
  const w = Math.min(Math.max(dims.w, 1), maxW);
  const h = Math.min(Math.max(dims.h, 1), maxH);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  // Re-flatten in case viewport-triggered lazy content re-introduced scrollers.
  await page.evaluate(flattenScrollers).catch(() => {});
  dims = await measure().catch(() => ({ w, h }));
  return { w: Math.min(Math.max(dims.w, w), maxW), h: Math.min(Math.max(dims.h, h), maxH) };
}

/** Render an artifact's production page to image bytes. */
export async function renderArtifactImage(
  env: Env,
  artifactId: string,
  opts: RenderOptions = {}
): Promise<ArrayBuffer | null> {
  const width = opts.width ?? THUMB_WIDTH;
  const height = opts.height ?? THUMB_HEIGHT;
  const type = opts.type ?? 'webp';

  return withArtifactPage(env, artifactId, { width, height }, opts, async (page) => {
    if (opts.fullPage) {
      // Resize the viewport to the full content, then capture an explicit clip at
      // 1x. fullPage renders blank here, and 2x scaling on tall pages blows past
      // Chromium's ~16k output-pixel limit (also blank) — so capture at 1x with a
      // bounded clip, matching how the PDF path emits one full-height page.
      const dims = await growToContent(page, 1600, 16000);
      const h = Math.min(dims.h, 16000);
      await page.setViewport({ width: dims.w, height: h, deviceScaleFactor: 1 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
      return (await page.screenshot({ type, quality: opts.quality, clip: { x: 0, y: 0, width: dims.w, height: h } } as Parameters<typeof page.screenshot>[0])) as unknown as ArrayBuffer;
    }
    return (await page.screenshot({ type, quality: opts.quality, clip: { x: 0, y: 0, width, height } } as Parameters<typeof page.screenshot>[0])) as unknown as ArrayBuffer;
  });
}

/** Render an artifact's production page to PDF bytes (captures screen layout). */
export async function renderArtifactPdf(
  env: Env,
  artifactId: string,
  opts: PdfOptions = {}
): Promise<ArrayBuffer | null> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 900;
  // PDF renders need more headroom than thumbnails — data must be fully loaded.
  const waits: WaitOptions = { idleTimeout: opts.idleTimeout ?? 12000, settleMs: opts.settleMs ?? 1500 };

  return withArtifactPage(env, artifactId, { width, height }, waits, async (page) => {
    // Print with screen styles so dashboards look like the live page, not print CSS.
    await page.emulateMediaType('screen').catch(() => {});

    // If a paper format is explicitly requested, paginate normally.
    if (opts.format) {
      return (await page.pdf({
        printBackground: true,
        format: opts.format,
        landscape: opts.landscape ?? true,
        margin: { top: '12px', bottom: '12px', left: '12px', right: '12px' },
      } as Parameters<typeof page.pdf>[0])) as unknown as ArrayBuffer;
    }

    // Default: one continuous page sized to the full content, so the whole
    // dashboard is captured (not just the first screen).
    const dims = await growToContent(page, 2000, 18000);
    const pdfWidth = Math.max(dims.w, width);
    const pdfHeight = Math.max(dims.h, height);

    return (await page.pdf({
      printBackground: true,
      width: `${pdfWidth}px`,
      height: `${pdfHeight}px`,
      pageRanges: '1',
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    } as Parameters<typeof page.pdf>[0])) as unknown as ArrayBuffer;
  });
}

/**
 * Data a report-style artifact may expose on `window.__shareoutExport` for
 * scheduled delivery: a ready-to-send email body (e.g. a ported PDF/email
 * template populated with live numbers) and a CSV string to attach. Optional —
 * absent fields fall back to the job's own config.
 */
export interface ArtifactExport {
  emailSubject?: string;
  emailHtml?: string;
  csv?: string;
  csvFilename?: string;
}

export interface CapturedReport {
  /** Full-content PDF of the rendered page, or null if BROWSER is unbound / render failed. */
  pdf: ArrayBuffer | null;
  /** Whatever the artifact published on window.__shareoutExport, or null. */
  data: ArtifactExport | null;
}

/**
 * Render an artifact's live page once and return BOTH a full-content PDF and the
 * artifact's `window.__shareoutExport` payload. Used by scheduled delivery so a
 * single headless render (with injected owner creds — the data re-runs against
 * the workspace connection) yields the PDF, the email HTML, and the CSV together.
 */
export async function captureArtifactReport(
  env: Env,
  artifactId: string,
  opts: PdfOptions = {}
): Promise<CapturedReport> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 900;
  const waits: WaitOptions = { idleTimeout: opts.idleTimeout ?? 12000, settleMs: opts.settleMs ?? 1500 };

  const out = await withArtifactPage(env, artifactId, { width, height }, waits, async (page) => {
    const data = (await page.evaluate(() => {
      const e = (globalThis as any).__shareoutExport;
      return e && typeof e === 'object' ? e : null;
    }).catch(() => null)) as ArtifactExport | null;

    await page.emulateMediaType('screen').catch(() => {});
    const dims = await growToContent(page, 2000, 18000);
    const pdf = (await page.pdf({
      printBackground: true,
      width: `${Math.max(dims.w, width)}px`,
      height: `${Math.max(dims.h, height)}px`,
      pageRanges: '1',
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    } as Parameters<typeof page.pdf>[0])) as unknown as ArrayBuffer;

    return { pdf, data };
  });

  return out ?? { pdf: null, data: null };
}

/**
 * Render an artifact's production page once and store two webp previews from the
 * same render: the full-res preview at thumbnails/<id>.webp (2400×1500 — used by
 * the detail modal, OG/social cards, and share emails) and a card-sized preview
 * at thumbnails/<id>_card.webp (~720×450 — served to the small grid cards so they
 * look crisp instead of a heavily-downscaled blur). Returns true when written.
 */
export async function generateArtifactThumbnail(env: Env, artifactId: string): Promise<boolean> {
  const shots = await withArtifactPage(
    env,
    artifactId,
    { width: THUMB_WIDTH, height: THUMB_HEIGHT },
    // Give data-heavy dashboards (BigQuery etc.) time to render before snapping
    // the first screen, matching the PDF path — avoids blank/skeleton previews.
    { idleTimeout: 12000, settleMs: 1500 },
    async (page) => {
      const clip = { x: 0, y: 0, width: THUMB_WIDTH, height: THUMB_HEIGHT };
      // Full preview at the 2x device scale set in withArtifactPage → 2400×1500.
      const full = (await page.screenshot({ type: 'webp', quality: 88, clip } as Parameters<typeof page.screenshot>[0])) as unknown as ArrayBuffer;
      // Re-rasterize the identical layout at a lower device scale for the card image.
      await page.setViewport({ width: THUMB_WIDTH, height: THUMB_HEIGHT, deviceScaleFactor: CARD_SCALE }).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
      const card = (await page.screenshot({ type: 'webp', quality: 90, clip } as Parameters<typeof page.screenshot>[0])) as unknown as ArrayBuffer;
      return { full, card };
    }
  );
  if (!shots) return false;

  await env.ARTIFACTS.put(`thumbnails/${artifactId}.webp`, shots.full, {
    httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=86400' },
  });
  await env.ARTIFACTS.put(`thumbnails/${artifactId}_card.webp`, shots.card, {
    httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=86400' },
  });

  await setPresentation(env, artifactId, {
    thumbnail_generated_at: new Date().toISOString(),
    thumbnail_ext: 'webp',
  });

  return true;
}

/** Render arbitrary HTML to a PNG screenshot (admin briefs, etc.). */
export async function renderHtmlToPng(
  env: Env,
  html: string,
  opts: { width?: number; height?: number } = {}
): Promise<ArrayBuffer | null> {
  if (!env.BROWSER) return null;
  const width = opts.width ?? 920;
  const height = opts.height ?? 1100;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(env.BROWSER as Parameters<typeof puppeteer.launch>[0]);
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 400));
    return (await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
    } as Parameters<typeof page.screenshot>[0])) as unknown as ArrayBuffer;
  } catch (err) {
    console.error('renderHtmlToPng failed', { error_stack: (err as Error)?.stack || String(err) });
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
