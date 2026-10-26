// Functions that run INSIDE the verify render (headless Chromium), not in the Worker.
// Puppeteer serializes each one with Function#toString, so they must be fully
// self-contained: no imports, no module-level values, DOM reached through globalThis
// (the Worker's TS lib has no DOM types — same convention as screenshots.ts).
import type { AxeViolation, DesignSignals, LayoutSignals } from './types';

/**
 * Runs before any artifact script, in every frame. Makes the page behave like the
 * viewer's sandboxed iframe (opaque origin, no allow-same-origin): storage, cookies,
 * IndexedDB and service workers throw SecurityError with Chrome's own messages, and
 * popups are swallowed so the render stays on this page. Also starts the LCP / CLS
 * observers the report reads back.
 */
export function installViewerEmulation(): void {
  const g = globalThis as any;
  if (g.__soVerify) return;
  const state = { lcp: null as number | null, cls: 0, storage: [] as string[], popups: 0 };
  Object.defineProperty(g, '__soVerify', { value: state });
  const note = (what: string) => {
    if (!state.storage.includes(what)) state.storage.push(what);
  };
  const denied = (message: string) => new g.DOMException(message, 'SecurityError');
  const lacking = "The document is sandboxed and lacks the 'allow-same-origin' flag.";

  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      Object.defineProperty(g, name, {
        configurable: true,
        enumerable: true,
        get() {
          note(name);
          throw denied(`Failed to read the '${name}' property from 'Window': ${lacking}`);
        },
      });
    } catch { /* leave the native accessor */ }
  }
  try {
    Object.defineProperty(g.Document.prototype, 'cookie', {
      configurable: true,
      enumerable: true,
      get() {
        note('cookie');
        throw denied(`Failed to read the 'cookie' property from 'Document': ${lacking}`);
      },
      set() {
        note('cookie');
        throw denied(`Failed to set the 'cookie' property on 'Document': ${lacking}`);
      },
    });
  } catch { /* leave the native accessor */ }
  try {
    if (g.IDBFactory) {
      g.IDBFactory.prototype.open = function () {
        note('indexedDB');
        throw denied("Failed to execute 'open' on 'IDBFactory': access to the Indexed Database API is denied in this context.");
      };
    }
  } catch { /* noop */ }
  try {
    if (g.ServiceWorkerContainer) {
      g.ServiceWorkerContainer.prototype.register = function () {
        note('serviceWorker');
        return Promise.reject(denied("Failed to register a ServiceWorker: The document is in an invalid state."));
      };
    }
  } catch { /* noop */ }
  try {
    g.open = function () {
      state.popups++;
      return null;
    };
  } catch { /* noop */ }

  try {
    new g.PerformanceObserver((list: any) => {
      for (const e of list.getEntries()) state.lcp = e.renderTime || e.loadTime || e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* unsupported */ }
  try {
    // CLS = the largest session window (gap < 1 s, span < 5 s), as web-vitals reports it.
    let windowValue = 0;
    let windowStart = 0;
    let last = 0;
    new g.PerformanceObserver((list: any) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        if (windowValue && (e.startTime - last > 1000 || e.startTime - windowStart > 5000)) windowValue = 0;
        if (!windowValue) windowStart = e.startTime;
        windowValue += e.value;
        last = e.startTime;
        if (windowValue > state.cls) state.cls = windowValue;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* unsupported */ }
}

export interface CollectedPage {
  layout: LayoutSignals;
  design: DesignSignals | null;
  lcp: number | null;
  cls: number | null;
  storage: string[];
  popups: number;
}

/** Layout (both viewports) and design lint (desktop) of the settled page. */
export function collectPageSignals(opts: { mobile: boolean; design: boolean }): CollectedPage {
  const g = globalThis as any;
  const d = g.document;
  // The initial containing block, not innerWidth: a phone zooms out to fit content
  // wider than the screen, which grows innerWidth to the content width and would hide
  // the very overflow being measured. Without a viewport meta tag it is ~980px.
  const vw: number = d.documentElement.clientWidth || g.innerWidth;
  const vh: number = g.innerHeight;
  const esc = (s: string) => (g.CSS && g.CSS.escape ? g.CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'));

  // Short, readable selector: up to 3 levels, stops at an id or at <body>.
  const selectorOf = (el: any): string => {
    const parts: string[] = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 3; depth++) {
      const tag = String(node.tagName).toLowerCase();
      if (tag === 'body' || tag === 'html') {
        if (!parts.length) parts.unshift(tag);
        break;
      }
      if (node.id) {
        parts.unshift(`${tag}#${esc(node.id)}`);
        break;
      }
      const classes = Array.prototype.slice.call(node.classList || [])
        .filter((c: string) => c.length < 32 && !/^(js-|is-|has-)/.test(c))
        .slice(0, 2);
      let part = classes.length ? `${tag}.${classes.map(esc).join('.')}` : tag;
      const parent = node.parentElement;
      if (parent && !classes.length) {
        const same = Array.prototype.filter.call(parent.children, (c: any) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ').slice(0, 140);
  };
  const visible = (el: any, r: any) => {
    if (r.width < 1 || r.height < 1) return false;
    const cs = g.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
  };
  const all: any[] = d.body ? Array.prototype.slice.call(d.body.getElementsByTagName('*'), 0, 6000) : [];

  // Horizontal overflow: the page scrolls sideways. Report the outermost elements that
  // stick out past the right edge and are not inside their own scroll/clip container.
  const scrollWidth = Math.max(d.documentElement.scrollWidth, d.body ? d.body.scrollWidth : 0);
  const overflow: Array<{ selector: string; px: number }> = [];
  if (scrollWidth > vw + 1) {
    const contained = (el: any) => {
      for (let p = el.parentElement; p && p !== d.body && p !== d.documentElement; p = p.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(g.getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= vw + 1) return true;
      }
      return false;
    };
    const sticking: Array<{ el: any; px: number }> = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const px = Math.round(r.right - vw);
      if (px <= 1 || r.width < 1 || r.height < 1) continue;
      if (g.getComputedStyle(el).position === 'fixed' || contained(el)) continue;
      sticking.push({ el, px });
    }
    const set = new Set(sticking.map((s) => s.el));
    sticking
      .filter((s) => !set.has(s.el.parentElement))
      .sort((a, b) => b.px - a.px)
      .slice(0, 3)
      .forEach((s) => overflow.push({ selector: selectorOf(s.el), px: s.px }));
  }

  // Tap targets on a phone: interactive elements under 44×44 CSS px. A link inside a
  // sentence and a checkbox wrapped by its <label> are exempt (the label is the target).
  const small: Array<{ selector: string; width: number; height: number; area: number }> = [];
  if (opts.mobile) {
    const targets = d.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [onclick]');
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (!visible(el, r) || el.closest('svg')) continue;
      if (r.width >= 44 && r.height >= 44) continue;
      if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) continue;
      if (el.tagName === 'A' && g.getComputedStyle(el).display === 'inline') {
        const inSentence = Array.prototype.some.call(el.parentNode ? el.parentNode.childNodes : [], (n: any) => n.nodeType === 3 && n.nodeValue.trim());
        if (inSentence) continue;
      }
      small.push({ selector: selectorOf(el), width: Math.round(r.width), height: Math.round(r.height), area: r.width * r.height });
    }
  }
  const examples: Array<{ selector: string; width: number; height: number }> = [];
  for (const s of small.sort((a, b) => a.area - b.area)) {
    if (examples.length >= 5) break;
    if (!examples.some((e) => e.selector === s.selector)) examples.push({ selector: s.selector, width: s.width, height: s.height });
  }

  const brokenImages: Array<{ selector: string; src: string }> = [];
  for (const img of d.images) {
    const src = String(img.currentSrc || img.src || '');
    if (!src || /\.svg(\?|#|$)|^data:image\/svg/i.test(src)) continue;
    if (img.complete && img.naturalWidth === 0 && brokenImages.length < 10) brokenImages.push({ selector: selectorOf(img), src: src.slice(0, 300) });
  }

  let visibleMedia = 0;
  for (const el of d.querySelectorAll('img, svg, canvas, video, iframe, picture, object, embed, input, button, select, textarea')) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height >= 400 && r.bottom > 0 && r.top < vh) visibleMedia++;
  }

  const declared = '__shareoutReady' in g
    || Array.prototype.some.call(d.scripts, (s: any) => !s.src && String(s.textContent || '').includes('__shareoutReady'));

  const layout: LayoutSignals = {
    viewportWidth: vw,
    scrollWidth,
    overflow,
    smallTargets: { count: small.length, examples },
    brokenImages,
    textLength: String(d.body ? d.body.innerText || '' : '').trim().length,
    visibleMedia,
    readyFlag: declared ? g.__shareoutReady === true : null,
  };

  let design: DesignSignals | null = null;
  if (opts.design) {
    // Fonts: first family of each visible text run, weighted by characters.
    const fontChars = new Map<string, number>();
    let totalChars = 0;
    const walker = d.createTreeWalker(d.body || d.documentElement, 4);
    for (let n = walker.nextNode(), seen = 0; n && seen < 4000; n = walker.nextNode(), seen++) {
      const text = String(n.nodeValue || '').trim();
      const el = n.parentElement;
      if (!text || !el || el.closest('script, style, noscript, svg, template')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const family = String(g.getComputedStyle(el).fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
      fontChars.set(family, (fontChars.get(family) || 0) + text.length);
      totalChars += text.length;
    }
    const fonts = Array.from(fontChars.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([family, chars]) => ({ family, share: totalChars ? Math.round((chars / totalChars) * 100) / 100 : 0 }));
    const failedFonts: string[] = [];
    try {
      d.fonts.forEach((f: any) => {
        if (f.status === 'error' && !failedFonts.includes(f.family)) failedFonts.push(String(f.family).replace(/^["']|["']$/g, ''));
      });
    } catch { /* no FontFaceSet */ }

    // Accents: chromatic colors on text, backgrounds and borders outside charts,
    // clustered by hue. Neutrals (low saturation, near black/white) are not accents.
    const weights = new Map<string, number>();
    const add = (color: string, weight: number) => {
      const m = color.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return;
      const key = `${Math.round(Number(m[1]))},${Math.round(Number(m[2]))},${Math.round(Number(m[3]))}`;
      weights.set(key, (weights.get(key) || 0) + weight);
    };
    for (const el of all.slice(0, 4000)) {
      if (el.closest('svg, canvas, [role=img], .plotly, .js-plotly-plot, .echarts, .apexcharts-canvas, .leaflet-container')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = g.getComputedStyle(el);
      add(cs.backgroundColor, Math.min(r.width * r.height, vw * 200) / 2000);
      let ownText = 0;
      for (const c of el.childNodes) if (c.nodeType === 3) ownText += String(c.nodeValue).trim().length;
      if (ownText) add(cs.color, ownText);
      if (parseFloat(cs.borderTopWidth) > 0) add(cs.borderTopColor, 2);
    }
    const chromatic: Array<{ hue: number; weight: number; hex: string }> = [];
    let chromaticWeight = 0;
    for (const [key, weight] of weights) {
      const [r, gr, b] = key.split(',').map((v) => Number(v) / 255);
      const max = Math.max(r, gr, b);
      const min = Math.min(r, gr, b);
      const l = (max + min) / 2;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      if (s < 0.3 || l < 0.18 || l > 0.88) continue;
      const delta = max - min;
      const hue = (max === r ? ((gr - b) / delta) % 6 : max === gr ? (b - r) / delta + 2 : (r - gr) / delta + 4) * 60;
      const hex = `#${key.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
      chromatic.push({ hue: (hue + 360) % 360, weight, hex });
      chromaticWeight += weight;
    }
    const clusters: Array<{ hue: number; weight: number; hex: string }> = [];
    for (const c of chromatic.sort((a, b) => b.weight - a.weight)) {
      const near = clusters.find((k) => Math.min(Math.abs(k.hue - c.hue), 360 - Math.abs(k.hue - c.hue)) <= 20);
      if (near) near.weight += c.weight;
      else clusters.push({ ...c });
    }
    const accents = clusters
      .filter((k) => k.weight >= chromaticWeight * 0.03)
      .sort((a, b) => b.weight - a.weight)
      .map((k) => k.hex);

    // Line length: characters per rendered line of the longest-lined paragraph.
    let longestLine: { selector: string; chars: number } | null = null;
    for (const el of d.querySelectorAll('p, li, blockquote, dd, figcaption')) {
      const text = String(el.innerText || '').trim();
      if (text.length < 120) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const range = d.createRange();
      range.selectNodeContents(el);
      const tops = new Set<number>();
      for (const rect of range.getClientRects()) if (rect.width > 1) tops.add(Math.round(rect.top / 6));
      const chars = Math.round(text.length / Math.max(1, tops.size));
      if (!longestLine || chars > longestLine.chars) longestLine = { selector: selectorOf(el), chars };
    }

    design = {
      fonts,
      failedFonts,
      accents,
      longestLine,
      title: String(d.title || '').trim().slice(0, 120),
      hasDescription: !!d.querySelector('meta[name="description"][content]'),
      hasOgImage: !!d.querySelector('meta[property="og:image"][content]'),
      hasFavicon: !!d.querySelector('link[rel~="icon"]'),
    };
  }

  const state = g.__soVerify || {};
  return {
    layout,
    design,
    lcp: typeof state.lcp === 'number' ? Math.round(state.lcp) : null,
    cls: typeof state.cls === 'number' ? Math.round(state.cls * 1000) / 1000 : null,
    storage: Array.isArray(state.storage) ? state.storage.slice(0, 10) : [],
    popups: Number(state.popups) || 0,
  };
}

/** axe-core (WCAG 2.0/2.1 A + AA rules) on the main document; iframes skipped. */
export async function runAxe(): Promise<{ violations: AxeViolation[] } | { error: string }> {
  const g = globalThis as any;
  if (!g.axe || typeof g.axe.run !== 'function') return { error: 'axe-core did not load' };
  const res = await g.axe.run(g.document, {
    iframes: false,
    resultTypes: ['violations'],
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
  return {
    violations: (res.violations || []).map((v: any) => ({
      id: String(v.id),
      impact: v.impact ?? null,
      help: String(v.help || ''),
      helpUrl: String(v.helpUrl || ''),
      nodes: (v.nodes || []).length,
      targets: (v.nodes || []).slice(0, 3).map((n: any) => [].concat(n.target || []).join(' ').slice(0, 140)),
    })),
  };
}
