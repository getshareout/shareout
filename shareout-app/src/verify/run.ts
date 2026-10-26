// The browser half of verify: one Browser Rendering session, one fresh browser context
// per viewport (desktop 1280×800 @1x, phone 390×844 @2x), run side by side. Each
// context opens the artifact's capture view on its content origin with no app session,
// behaves like the viewer's sandbox (installViewerEmulation), runs under the shared
// capture request policy with verify's stricter rules (the main frame stays on the page,
// the viewers' CSP is enforced) and records what broke. Pure collection — report.ts
// classifies.
import type { Env } from '../types';
import {
  captureThumbnailShots, growToContentHeight, storeThumbnail, THUMBNAIL_VIEWPORT, waitForArtifactReady, withArtifactBrowser,
  type RenderBrowser, type RenderPage,
} from '../screenshots';
import { collectPageSignals, installViewerEmulation, runAxe, type CollectedPage } from './in-page';
import { guardCapturePage, type CaptureDataSession } from '../screenshots/request-policy';
import type { CspPolicy } from '../screenshots/csp';
import type { BlockedSignal, ConsoleSignal, PageErrorSignal, PageSignals, RequestSignal, Viewport, ViewportSpec } from './types';
import { VIEWPORTS } from './types';

/** axe-core, served by this instance's /vendor (allowlisted in vendor-cdn/registry.ts). */
export const AXE_VERSION = '4.13.0';
const AXE_PATH = `/vendor/axe-core@${AXE_VERSION}/axe.min.js`;

const NAV_TIMEOUT_MS = 20_000;
const READY_WAIT = { idleTimeout: 8000, settleMs: 600 };
const SESSION_BUDGET_MS = 50_000;
const MAX_SHOT_PX = 4000;
const MAX_ENTRIES = 20;

/** What one viewport opens: the capture URL (its main frame may load nothing else) and the file it renders. */
export interface ViewTarget {
  url: string;
  entrypoint: string;
}

export interface RenderPlan {
  artifactId: string;
  /** Desktop renders the main entrypoint; the phone the mobile one when the version has it. */
  targets: Record<Viewport, ViewTarget>;
  pageOrigin: string;
  /** The artifact's folder on pageOrigin: /a/{slug}/, /c/{ct}/ or /. */
  basePath: string;
  platformOrigin: string;
  /** Appended to the page's own file requests (capture token, pinned version), or null. */
  fileQuery: string | null;
  /** This instance's hosts, exempt from the private-network rule. */
  ownHosts: string[];
  /** The Content-Security-Policy this page's viewers get. */
  csp: CspPolicy;
  /** The read-only session attached to this artifact's data requests (never in the page). */
  dataSession: CaptureDataSession;
  viewports: Viewport[];
  fullPage: boolean;
  refreshThumbnail: boolean;
}

/** How a viewport names the URLs it reports. */
interface PageView {
  pageOrigin: string;
  basePath: string;
  entrypoint: string;
  platformOrigin: string;
}

export interface RenderOutcome {
  signals: PageSignals[];
  thumbnailRefreshed: boolean;
}

const noop = () => {};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const SECRET_PARAM = /token|key|secret|sig|auth|session|pass|capture|credential|code/i;

/**
 * Strip the render's own credentials from page-controlled text before it leaves the
 * Worker: the capture token (query), the content capability (/c/<ct>/) and anything
 * shaped like a ShareOut access token (the page can read and print all three).
 */
export function scrub(text: string): string {
  return text
    .replace(/([?&]_capture=)[^&#\s"'<>]+/g, '$1…')
    .replace(/\/c\/[^/\s"'?#<>]+\//g, '/c/…/')
    .replace(/eyJ[A-Za-z0-9+/_=-]{8,}\.[A-Za-z0-9+/_=-]{8,}/g, '…');
}

/** Readable, credential-free form of a URL the page touched. */
export function displayUrl(raw: string, plan: PageView): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return scrub(raw.slice(0, 160));
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return `${u.protocol}…`;
  if (u.origin === plan.pageOrigin && u.pathname.startsWith(plan.basePath)) {
    let rel = u.pathname.slice(plan.basePath.length);
    try { rel = decodeURIComponent(rel); } catch { /* keep encoded */ }
    return scrub(rel || plan.entrypoint);
  }
  const query = [...u.searchParams].map(([k, v]) => `${k}=${SECRET_PARAM.test(k) ? '…' : v.slice(0, 40)}`).join('&');
  const path = `${u.pathname}${query ? `?${query}` : ''}`;
  const local = u.origin === plan.pageOrigin || u.origin === plan.platformOrigin;
  return scrub((local ? path : `${u.host}${path}`).slice(0, 160));
}

function bump<T extends { count: number }>(list: T[], entry: T, same: (a: T) => boolean): void {
  const prev = list.find(same);
  if (prev) prev.count++;
  else if (list.length < MAX_ENTRIES) list.push(entry);
}

/** The page's own file URL with the plan's file query added, or null to leave the request alone. */
export function withFileQuery(raw: string, plan: Pick<RenderPlan, 'pageOrigin' | 'basePath' | 'fileQuery'>): string | null {
  if (!plan.fileQuery) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.origin !== plan.pageOrigin || !u.pathname.startsWith(plan.basePath) || /^\/(sdk|vendor|lib)\//.test(u.pathname)) return null;
  for (const [k, v] of new URLSearchParams(plan.fileQuery)) u.searchParams.set(k, v);
  return u.toString();
}

function emptySignals(viewport: Viewport, entrypoint: string): PageSignals {
  return {
    viewport, entrypoint, loadMs: 0, pageErrors: [], console: [], requests: [], blocked: [], dialogs: [], storage: [], popups: 0,
    layout: null, design: null, axe: null, metrics: { lcpMs: null, cls: null, bytes: null, requests: 0 }, screenshot: null,
  };
}

function failedSignals(viewport: Viewport, entrypoint: string, err: unknown): PageSignals {
  const message = String((err as Error)?.message || err).split('\n')[0];
  const timedOut = /timeout|timed out/i.test(message);
  return { ...emptySignals(viewport, entrypoint), renderError: `Could not open the page: ${timedOut ? `it did not finish loading within ${NAV_TIMEOUT_MS / 1000} s` : message.slice(0, 200)}` };
}

function mobileUserAgent(ua: string): string {
  const version = ua.match(/(?:Headless)?Chrome\/([\d.]+)/)?.[1] ?? '130.0.0.0';
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`;
}

interface Tracker {
  bytes(): number | null;
  requests: number;
  pending: Array<Promise<void>>;
}

/** Byte counts and exceptions (with url:line:col, syntax errors included) from a CDP session. */
async function track(page: RenderPage, s: PageSignals, plan: PageView, isTooling: (url: string) => boolean): Promise<Tracker> {
  const tracker: Tracker = { bytes: () => null, requests: 0, pending: [] };
  const addError = (raw: string, url: string | undefined, line?: number, col?: number) => {
    if (url && isTooling(url)) return;
    const message = scrub(raw).slice(0, 300);
    const where = url && /^https?:/.test(url) && line !== undefined ? `${displayUrl(url, plan)}:${line + 1}:${(col ?? 0) + 1}` : undefined;
    bump<PageErrorSignal>(s.pageErrors, { message, where, count: 1 }, (e) => e.message === message && e.where === where);
  };
  try {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    let bytes = 0;
    cdp.on('Network.loadingFinished', (e: { encodedDataLength?: number }) => { bytes += e.encodedDataLength || 0; });
    cdp.on('Runtime.exceptionThrown', (e: { exceptionDetails: any }) => {
      const d = e.exceptionDetails || {};
      const ex = d.exception || {};
      const text = String(ex.description ?? (ex.value !== undefined ? ex.value : d.text ?? 'Error')).split('\n')[0];
      const frame = (d.stackTrace?.callFrames || []).find((f: { url?: string }) => /^https?:/.test(f.url || '') && !isTooling(f.url || ''));
      const message = `${/in promise/.test(String(d.text)) ? '(in promise) ' : ''}${text}`;
      if (frame) addError(message, frame.url, frame.lineNumber, frame.columnNumber);
      else addError(message, d.url, d.lineNumber, d.columnNumber);
    });
    tracker.bytes = () => bytes;
  } catch {
    page.on('pageerror', (err: unknown) => addError(String((err as Error)?.message ?? err).split('\n')[0], undefined));
  }
  return tracker;
}

function listen(page: RenderPage, s: PageSignals, plan: PageView, tracker: Tracker, isTooling: (url: string) => boolean): void {
  page.on('console', (msg) => {
    const type = msg.type() as string;
    if (type !== 'error' && type !== 'warn' && type !== 'warning') return;
    const text = scrub(msg.text());
    if (/^Failed to load resource/.test(text)) return; // the network check reports it
    const loc = msg.location();
    if (loc?.url && isTooling(loc.url)) return;
    const where = loc?.url && /^https?:/.test(loc.url) ? `${displayUrl(loc.url, plan)}${loc.lineNumber !== undefined ? `:${loc.lineNumber + 1}` : ''}` : undefined;
    const level = type === 'error' ? 'error' : 'warning';
    const entry: ConsoleSignal = { level, text: text.slice(0, 300), where, count: 1 };
    bump(s.console, entry, (c) => c.level === level && c.text === entry.text && c.where === where);
  });
  // Tabs a script opens (e.g. a clicked target=_blank link) are not this page: close them.
  page.on('popup', (popup) => {
    s.popups++;
    popup?.close().catch(noop);
  });
  page.on('dialog', (dialog) => {
    const type = dialog.type();
    const message = scrub(dialog.message()).slice(0, 120);
    bump(s.dialogs, { type, message, count: 1 }, (d) => d.type === type && d.message === message);
    dialog.dismiss().catch(noop);
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText || 'failed';
    // Our own aborts are recorded by route(); ERR_ABORTED is the page cancelling its own request.
    if (/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/.test(failure) || isTooling(req.url())) return;
    const entry: RequestSignal = { url: displayUrl(req.url(), plan), method: req.method(), type: req.resourceType(), failure: failure.replace(/^net::/, ''), count: 1 };
    bump(s.requests, entry, (r) => r.url === entry.url && r.method === entry.method && r.failure === entry.failure);
  });
  page.on('response', (res) => {
    const status = res.status();
    if (status < 400) return;
    const req = res.request();
    const raw = req.url();
    if (isTooling(raw) || /\/favicon\.ico(\?|$)/.test(raw)) return;
    const entry: RequestSignal = { url: displayUrl(raw, plan), method: req.method(), type: req.resourceType(), status, count: 1 };
    let api = false;
    try {
      const u = new URL(raw);
      api = u.origin === plan.platformOrigin && u.pathname.startsWith('/v1/');
    } catch { /* not a URL */ }
    if (api) {
      tracker.pending.push(res.text().then((text) => {
        const body = JSON.parse(text) as { code?: unknown; hint?: unknown; error?: unknown; message?: unknown };
        const message = String(body.error ?? body.message ?? '');
        if (req.method() !== 'GET' && status === 403 && /read-only test run/i.test(message)) {
          entry.readOnlySkip = true;
          return;
        }
        if (typeof body.code === 'string') entry.code = body.code.slice(0, 60);
        if (typeof body.hint === 'string') entry.hint = body.hint.slice(0, 300);
      }).catch(noop));
    }
    bump(s.requests, entry, (r) => r.url === entry.url && r.method === entry.method && r.status === status);
  });
}

async function shoot(page: RenderPage, spec: ViewportSpec, fullPage: boolean): Promise<PageSignals['screenshot']> {
  const height = fullPage
    ? await growToContentHeight(page, Math.floor(MAX_SHOT_PX / (spec.shotScale * spec.dpr)))
    : spec.height;
  const raw = await page.screenshot({
    type: 'webp',
    quality: 80,
    clip: { x: 0, y: 0, width: spec.width, height, scale: spec.shotScale },
  } as Parameters<typeof page.screenshot>[0]);
  return {
    bytes: new Uint8Array(raw as unknown as ArrayBuffer),
    width: Math.round(spec.width * spec.shotScale * spec.dpr),
    height: Math.round(height * spec.shotScale * spec.dpr),
    fullPage,
  };
}

interface InspectOptions {
  axe: boolean;
  design: boolean;
  userAgent: string;
  onThumbnail: () => void;
}

async function inspect(env: Env, browser: RenderBrowser, spec: ViewportSpec, plan: RenderPlan, opts: InspectOptions): Promise<PageSignals> {
  const target = plan.targets[spec.name];
  const view: PageView = { pageOrigin: plan.pageOrigin, basePath: plan.basePath, entrypoint: target.entrypoint, platformOrigin: plan.platformOrigin };
  const s = emptySignals(spec.name, target.entrypoint);
  const axeUrl = `${plan.pageOrigin}${AXE_PATH}`;
  // Our own injected script — also where /vendor redirects it (VENDOR_LIBS_DISABLED). Exact
  // URLs only: anything looser would let a page route requests past the guards below.
  const tooling = new Set([axeUrl, `https://cdn.jsdelivr.net/npm/axe-core@${AXE_VERSION}/axe.min.js`]);
  const isTooling = (url: string) => tooling.has(url);
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setViewport({ width: spec.width, height: spec.height, deviceScaleFactor: spec.dpr, isMobile: spec.mobile, hasTouch: spec.mobile });
    if (opts.userAgent) {
      await page.setUserAgent(spec.mobile ? mobileUserAgent(opts.userAgent) : opts.userAgent.replace('HeadlessChrome', 'Chrome'));
    }
    await page.evaluateOnNewDocument(installViewerEmulation);
    const tracker = await track(page, s, view, isTooling);
    listen(page, s, view, tracker, isTooling);
    const guard = await guardCapturePage(page, plan.ownHosts, {
      dataSession: plan.dataSession,
      rules: { mainFrameUrl: target.url, csp: { policy: plan.csp, selfOrigin: plan.pageOrigin } },
      // The page's own files carry the capture link (and pinned version) the server needs
      // to serve them from that version, or without a session cookie on a private page.
      rewriteUrl: (url) => withFileQuery(url, plan),
      onRequest: (req, verdict) => {
        const url = req.url();
        if (isTooling(url)) return;
        if (verdict.allow) {
          if (!/^(data|blob):/.test(url)) tracker.requests++;
          return;
        }
        const entry: BlockedSignal = { reason: verdict.reason, url: displayUrl(url, view), type: req.resourceType(), directive: verdict.directive, count: 1 };
        bump(s.blocked, entry, (b) => b.reason === entry.reason && b.url === entry.url);
      },
    });

    const t0 = Date.now();
    const response = await page.goto(target.url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    s.loadMs = Date.now() - t0;
    if (!response || response.status() >= 400) {
      s.renderError = `Could not open the page: ${response ? `it answered HTTP ${response.status()}` : 'it did not respond'}`;
      return s;
    }
    await waitForArtifactReady(page, READY_WAIT);

    const collected = await withTimeout(
      page.evaluate(collectPageSignals, { mobile: spec.mobile, design: opts.design }) as Promise<CollectedPage>,
      10_000,
    ).catch(() => null);
    if (collected) {
      s.layout = collected.layout;
      s.design = collected.design;
      s.storage = collected.storage;
      s.popups += collected.popups;
    }
    // Snapshot before axe-core is injected so its bytes never count against the page.
    s.metrics = { lcpMs: collected?.lcp ?? null, cls: collected?.cls ?? null, bytes: tracker.bytes(), requests: tracker.requests };

    if (!plan.fullPage) s.screenshot = await shoot(page, spec, false);
    if (opts.axe) {
      const loaded = await withTimeout(page.addScriptTag({ url: axeUrl }).then(() => true), 8000).catch(() => null);
      s.axe = loaded
        ? (await withTimeout(page.evaluate(runAxe) as Promise<NonNullable<PageSignals['axe']>>, 15_000).catch((e: Error) => ({ error: e.message.slice(0, 120) })))
          ?? { error: 'timed out' }
        : { error: 'axe-core could not be loaded' };
    }
    if (spec.name === 'desktop' && plan.refreshThumbnail && !guard.privateResponse()) {
      await page.setViewport(THUMBNAIL_VIEWPORT);
      await new Promise((r) => setTimeout(r, 300));
      await storeThumbnail(env, plan.artifactId, await captureThumbnailShots(page));
      opts.onThumbnail();
      if (plan.fullPage) {
        await page.setViewport({ width: spec.width, height: spec.height, deviceScaleFactor: spec.dpr, isMobile: spec.mobile, hasTouch: spec.mobile });
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (plan.fullPage) s.screenshot = await shoot(page, spec, true);
    await withTimeout(Promise.all(tracker.pending), 2000);
    const privateAddress = guard.privateResponse();
    if (privateAddress) {
      // Never hand back what a private-network response may have put on the page.
      return { ...emptySignals(spec.name, target.entrypoint), renderError: `Results withheld: the page loaded content from a private network address (${privateAddress})` };
    }
    return s;
  } finally {
    await context.close().catch(noop);
  }
}

// A target swapped or closed under a navigation; a fresh context usually just works.
const TRANSIENT = /detached|Target closed|Session closed|Execution context was destroyed/i;

/** Render every requested viewport in one browser session. null = no session (unbound,
 *  launch failure or over budget) — the caller falls back to source checks. */
export async function renderForVerify(env: Env, plan: RenderPlan): Promise<RenderOutcome | null> {
  return withArtifactBrowser(env, plan.artifactId, async (browser) => {
    const userAgent = await browser.userAgent().catch(() => '');
    let thumbnailRefreshed = false;
    const signals = await withTimeout(Promise.all(plan.viewports.map((vp, i) => {
      const attempt = () => inspect(env, browser, VIEWPORTS[vp], plan, {
        axe: i === 0,
        design: i === 0,
        userAgent,
        onThumbnail: () => { thumbnailRefreshed = true; },
      });
      return attempt()
        .catch((err) => (TRANSIENT.test(String((err as Error)?.message)) ? attempt() : Promise.reject(err)))
        .catch((err) => failedSignals(vp, plan.targets[vp].entrypoint, err));
    })), SESSION_BUDGET_MS);
    return signals ? { signals, thumbnailRefreshed } : null;
  });
}
