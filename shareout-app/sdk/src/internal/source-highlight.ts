import { getInitOrigin, getPostMessageData } from './embedded-init';

/**
 * The page's half of the viewer's "Data sources" panel. The ShareOut page around the
 * artifact can't see into this sandboxed frame, so:
 *
 * - The frame tells its host once that it shows data (`shareout:sources:hint`), so the
 *   host can offer the panel. No names, values or counts leave the frame.
 * - The host asks the frame to outline the elements a source feeds
 *   (`shareout:sources:highlight`). Only the framing ShareOut page may ask: the message
 *   must come from `window.parent` AND from the origin that delivered `shareout:init`
 *   (or the instance origin it named). Nothing is ever sent back.
 */

const HINT = 'shareout:sources:hint';
const PING = 'shareout:sources:ping';
const HIGHLIGHT = 'shareout:sources:highlight';

const CLASS = 'so-src-hl';
const STYLE_ID = 'so-src-hl-css';
const MAX_SELECTORS = 100;
const MAX_SELECTOR_LENGTH = 300;
const MAX_ELEMENTS = 200;
const REF = /^[a-z]+:[A-Za-z0-9_.~-]{1,128}$/;
const BOUND = '[data-shareout-binding],[data-shareout-source],[data-shareout-template-source],[data-shareout-chart-data],[data-shareout-options-source]';
// Data-store calls (not comments, agents or crews): the page shows data.
const DATA_PATH = /^\/(json|tables|connections|datasets|platform|mcp|knowledge|secrets|blobs|workspace\/tables)(\/|\?|$)/;

// Design tokens from /sdk/shareout.css when the page links it; system colors otherwise.
const CSS = `.${CLASS}{outline:2px solid var(--so-color-primary,Highlight)!important;outline-offset:3px!important;
box-shadow:0 0 0 6px var(--so-color-primary-glow,transparent)!important;
transition:outline-color var(--so-duration-fast,100ms) ease-out,box-shadow var(--so-duration-fast,100ms) ease-out}
@media (prefers-reduced-motion:reduce){.${CLASS}{transition:none!important}}`;

let lit: Element[] = [];
let hinted = false;
let activity = false;

function embedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

/** At most two origins: the one that delivered init, and the instance it named. */
function trustedOrigins(): string[] {
  const out: string[] = [];
  const init = getInitOrigin();
  if (init && init !== 'null') out.push(init);
  const base = getPostMessageData()?.baseUrl ?? initialDataBaseUrl();
  if (base) {
    try {
      const origin = new URL(base).origin;
      if (origin !== 'null' && !out.includes(origin)) out.push(origin);
    } catch {
      // not a URL: not trusted
    }
  }
  return out;
}

function initialDataBaseUrl(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const node = document.getElementById('shareout-initial-data');
  if (!node?.textContent) return undefined;
  try {
    const base = (JSON.parse(node.textContent) as { baseUrl?: unknown }).baseUrl;
    return typeof base === 'string' ? base : undefined;
  } catch {
    return undefined;
  }
}

export function isTrustedHostMessage(e: MessageEvent): boolean {
  if (!embedded() || e.source !== window.parent) return false;
  if (!e.origin || e.origin === 'null') return false;
  return trustedOrigins().includes(e.origin);
}

function manifest(): { sources?: Record<string, unknown>; feeds?: unknown } | null {
  const node = typeof document !== 'undefined' ? document.querySelector('script[type="shareout/manifest"]') : null;
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

function showsData(): boolean {
  if (activity) return true;
  if (typeof document === 'undefined') return false;
  if (document.querySelector(BOUND)) return true;
  const m = manifest();
  const sources = (m?.sources ?? {}) as Record<string, unknown>;
  const declared = ['json', 'tables', 'connections'].some((k) => {
    const bucket = sources[k];
    return !!bucket && typeof bucket === 'object' && Object.keys(bucket).length > 0;
  });
  return declared || (Array.isArray(m?.feeds) && m.feeds.length > 0);
}

/** Tell the host this page shows data — once, or again when the host asks. */
export function announceSources(force = false): void {
  if (!embedded() || (hinted && !force) || !showsData()) return;
  const target = trustedOrigins()[0];
  if (!target) return; // no host named yet; init will retry
  hinted = true;
  try {
    window.parent.postMessage({ type: HINT }, target);
  } catch {
    // detached frame
  }
}

/** Called for every SDK request; the first data-store call is enough to show the panel. */
export function noteDataRequest(path: string): void {
  if (activity || !DATA_PATH.test(path)) return;
  activity = true;
  announceSources();
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

function collect(found: Set<Element>, selector: string): void {
  if (found.size >= MAX_ELEMENTS) return;
  try {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (found.size >= MAX_ELEMENTS) return;
      found.add(el);
    }
  } catch {
    // invalid selector: skip it
  }
}

/**
 * Outline the elements `ref` feeds: its `data-shareout-source` tags, manifest feeds,
 * and the selectors the host derived from the published page. A non-ref clears.
 * Returns how many elements are outlined (for tests; nothing is posted back).
 */
export function highlightSources(ref: unknown, selectors?: unknown, scroll?: unknown): number {
  for (const el of lit) el.classList.remove(CLASS);
  lit = [];
  if (typeof document === 'undefined' || typeof ref !== 'string' || !REF.test(ref)) return 0;

  const found = new Set<Element>();
  for (const el of Array.from(document.querySelectorAll('[data-shareout-source]'))) {
    if (found.size >= MAX_ELEMENTS) break;
    if (el.getAttribute('data-shareout-source')?.trim() === ref) found.add(el);
  }
  const feeds = manifest()?.feeds;
  if (Array.isArray(feeds)) {
    for (const f of feeds as Array<{ element?: unknown; source?: unknown }>) {
      if (f && f.source === ref && typeof f.element === 'string') collect(found, f.element);
    }
  }
  if (Array.isArray(selectors)) {
    for (const s of selectors.slice(0, MAX_SELECTORS)) {
      if (typeof s === 'string' && s.length <= MAX_SELECTOR_LENGTH) collect(found, s);
    }
  }
  if (!found.size) return 0;

  ensureStyle();
  lit = Array.from(found);
  for (const el of lit) el.classList.add(CLASS);
  if (scroll === true && typeof lit[0].scrollIntoView === 'function') {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    lit[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }
  return lit.length;
}

if (embedded()) {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: unknown; ref?: unknown; selectors?: unknown; scroll?: unknown } | null;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
    // init names the host: the hint can go out now (after embedded-init stored it).
    if (d.type === 'shareout:init' && e.source === window.parent) {
      setTimeout(() => announceSources(), 0);
      return;
    }
    if (d.type !== PING && d.type !== HIGHLIGHT) return;
    if (!isTrustedHostMessage(e)) return;
    if (d.type === PING) announceSources(true);
    else highlightSources(d.ref, d.selectors, d.scroll);
  });
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => announceSources(), { once: true });
  } else {
    announceSources();
  }
}
