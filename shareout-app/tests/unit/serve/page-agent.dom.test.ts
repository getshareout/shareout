// @vitest-environment happy-dom
//
// Multi-page artifacts: the agent injected into each artifact page (inside the
// sandboxed content frame) and the wrapper-side bridge. Both run against fakes for
// the frame globals (parent, location, listeners) so cross-frame behavior is testable.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPageAgent, isSafePagePath, renderPageBridge } from '../../../src/serve/page-agent';

const BASE = 'https://shareout.example.com';
const CDN = 'https://abc123.cdn.example';

type Listener = (e: { source?: unknown; data?: unknown }) => void;

function runAgent(opts: { href: string; page?: string; entry?: string; slug?: string }) {
  const url = new URL(opts.href);
  const posted: unknown[] = [];
  const listeners: Record<string, Listener[]> = {};
  const parent = { postMessage: (m: unknown) => posted.push(m) };
  const loc = { origin: url.origin, pathname: url.pathname, href: url.href };
  const open = vi.fn();
  const win = { parent, open };
  const on = (type: string, fn: Listener) => { (listeners[type] ||= []).push(fn); };
  const clickers: Array<(e: unknown) => void> = [];
  const doc = { addEventListener: (_t: string, fn: (e: unknown) => void) => clickers.push(fn) };
  const code = buildPageAgent(opts.slug ?? 'demo', BASE, opts.page ?? 'index.html', opts.entry ?? 'index.html');
  new Function('window', 'parent', 'location', 'addEventListener', 'document', code)(win, parent, loc, on, doc);
  const fire = (type: string, e: { source?: unknown; data?: unknown } = {}) => (listeners[type] || []).forEach((f) => f(e));
  const click = (href: string, mods: Record<string, boolean> = {}, attrs: Record<string, string> = {}) => {
    document.body.innerHTML = '';
    const a = document.createElement('a');
    a.setAttribute('href', href);
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    const span = document.createElement('span');
    a.appendChild(span);
    document.body.appendChild(a);
    const ev = { target: span, button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods, preventDefault() { ev.defaultPrevented = true; } };
    clickers.forEach((f) => f(ev));
    return ev.defaultPrevented;
  };
  return { posted, loc, open, fire, click, parent };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('page agent: same-artifact links stay inside the content frame', () => {
  it('rewrites an absolute platform link to the page under the private /c/<ct>/ root', () => {
    const a = runAgent({ href: `${CDN}/c/tok123/docs/a.html`, page: 'docs/a.html' });
    expect(a.click(`${BASE}/a/demo/docs/b.html#step-2`)).toBe(true);
    expect(a.loc.href).toBe('/c/tok123/docs/b.html#step-2');
  });

  it('rewrites a root-relative /a/<slug>/ link (which on the CDN would 404 / nest a viewer)', () => {
    const a = runAgent({ href: `${CDN}/guide.html`, page: 'guide.html' });
    expect(a.click('/a/demo/faq.html?x=1')).toBe(true);
    expect(a.loc.href).toBe('/faq.html?x=1');
  });

  it('sends the artifact home link to the content root on the CDN', () => {
    const a = runAgent({ href: `${CDN}/c/tok/guide.html`, page: 'guide.html' });
    expect(a.click(`${BASE}/a/demo/`)).toBe(true);
    expect(a.loc.href).toBe('/c/tok/');
  });

  it('same-zone mode: the home link names the entrypoint so it never loads the viewer', () => {
    const a = runAgent({ href: `${BASE}/a/demo/docs/a.html?_raw`, page: 'docs/a.html', entry: 'index.html' });
    expect(a.click('/a/demo/')).toBe(true);
    expect(a.loc.href).toBe('/a/demo/index.html');
  });

  it('resolves the root when the entrypoint is served at /', () => {
    const a = runAgent({ href: `${CDN}/`, page: 'index.html' });
    expect(a.click(`${BASE}/a/demo/docs/b.html`)).toBe(true);
    expect(a.loc.href).toBe('/docs/b.html');
  });

  it('leaves relative links, other hosts, modified clicks and explicit targets to the browser', () => {
    const a = runAgent({ href: `${CDN}/index.html` });
    expect(a.click('docs/b.html')).toBe(false);
    expect(a.click('https://example.org/a/demo/x.html')).toBe(false);
    expect(a.click(`${BASE}/a/demo/x.html`, { metaKey: true })).toBe(false);
    expect(a.click(`${BASE}/a/demo/x.html`, {}, { target: '_blank' })).toBe(false);
    expect(a.click(`${BASE}/v1/artifacts`)).toBe(false);
    expect(a.loc.href).toBe(`${CDN}/index.html`);
  });
});

describe('page agent: other artifacts never load inside the frame', () => {
  it('opens a new top-level tab outside the shell', () => {
    const a = runAgent({ href: `${CDN}/index.html` });
    expect(a.click(`${BASE}/a/other-doc/intro.html`)).toBe(true);
    expect(a.open).toHaveBeenCalledWith(`${BASE}/a/other-doc/intro.html`, '_blank', 'noopener');
    expect(a.loc.href).toBe(`${CDN}/index.html`);
  });

  it('asks the shell for a tab once the wrapper says it is in the shell', () => {
    const a = runAgent({ href: `${CDN}/index.html` });
    a.fire('message', { source: {}, data: { type: 'shareout:shell' } });
    expect(a.click('/a/other-doc/a%20b.html')).toBe(true);
    expect(a.open).toHaveBeenCalledTimes(1); // a non-parent "shell" claim is ignored
    a.fire('message', { source: a.parent, data: { type: 'shareout:shell' } });
    expect(a.click('/a/other-doc/a%20b.html')).toBe(true);
    expect(a.open).toHaveBeenCalledTimes(1);
    expect(a.posted).toContainEqual({ type: 'shareout:open-artifact', slug: 'other-doc', path: 'a b.html' });
  });
});

describe('page agent: page awareness', () => {
  it('reports the shown page to the wrapper on pageshow', () => {
    const a = runAgent({ href: `${CDN}/docs/a.html`, page: 'docs/a.html' });
    a.fire('pageshow');
    expect(a.posted).toEqual([{ type: 'shareout:page', path: 'docs/a.html' }]);
  });

  it('does nothing at top level', () => {
    const posted: unknown[] = [];
    const win: Record<string, unknown> = {};
    win.parent = win;
    const on = vi.fn();
    new Function('window', 'parent', 'location', 'addEventListener', 'document', buildPageAgent('demo', BASE, 'index.html', 'index.html'))(win, { postMessage: (m: unknown) => posted.push(m) }, {}, on, { addEventListener: on });
    expect(on).not.toHaveBeenCalled();
  });

  it('escapes </script> in embedded constants', () => {
    expect(buildPageAgent('demo', BASE, '</script><b>.html', 'index.html')).not.toContain('</script>');
  });
});

function runBridge(opts: { inShell: boolean; entry?: string; active?: boolean; href?: string }) {
  const html = renderPageBridge('demo', opts.entry ?? 'index.html', opts.inShell);
  const code = html.replace(/^<script>/, '').replace(/<\/script>$/, '');
  const contentWin = { postMessage: vi.fn() };
  const iframe = { contentWindow: contentWin };
  const listeners: Listener[] = [];
  const parentPosts: unknown[][] = [];
  const parent = { postMessage: (...args: unknown[]) => parentPosts.push(args) };
  const win = { parent };
  const replaceState = vi.fn();
  const loc = { href: opts.href ?? `${BASE}/a/demo/`, origin: BASE };
  const doc = { querySelector: () => iframe };
  const nav = { userActivation: { isActive: opts.active ?? true } };
  new Function('window', 'location', 'history', 'document', 'navigator', 'addEventListener', code)(
    win, loc, { state: null, replaceState }, doc, nav, (_t: string, fn: Listener) => listeners.push(fn),
  );
  const send = (data: unknown, source: unknown = contentWin) => listeners.forEach((f) => f({ source, data }));
  return { send, parentPosts, replaceState, contentWin, win: win as typeof win & { __soErrors?: unknown[] } };
}

describe('viewer page bridge', () => {
  it('in the shell: forwards the page (entrypoint as empty) and tells the frame it is in the shell', () => {
    const b = runBridge({ inShell: true });
    b.send({ type: 'shareout:page', path: 'docs/b.html' });
    b.send({ type: 'shareout:page', path: 'index.html' });
    expect(b.parentPosts).toEqual([
      [{ type: 'shareout:page', slug: 'demo', page: 'docs/b.html' }, BASE],
      [{ type: 'shareout:page', slug: 'demo', page: '' }, BASE],
    ]);
    expect(b.contentWin.postMessage).toHaveBeenCalledWith({ type: 'shareout:shell' }, '*');
  });

  it('ignores messages that do not come from its content frame', () => {
    const b = runBridge({ inShell: true });
    b.send({ type: 'shareout:page', path: 'docs/b.html' }, {});
    b.send({ type: 'shareout:open-artifact', slug: 'other' }, {});
    expect(b.parentPosts).toEqual([]);
  });

  it('forwards cross-artifact opens only during a user gesture and with a valid slug', () => {
    const idle = runBridge({ inShell: true, active: false });
    idle.send({ type: 'shareout:open-artifact', slug: 'other', path: 'x.html' });
    expect(idle.parentPosts).toEqual([]);
    const b = runBridge({ inShell: true });
    b.send({ type: 'shareout:open-artifact', slug: '../evil', path: '' });
    b.send({ type: 'shareout:open-artifact', slug: 'other', path: 'x.html' });
    expect(b.parentPosts).toEqual([[{ type: 'shareout:open-artifact', slug: 'other', page: 'x.html' }, BASE]]);
  });

  it('standalone: mirrors the sub-page into ?page= and never posts upward', () => {
    const b = runBridge({ inShell: false, href: `${BASE}/a/demo/` });
    b.send({ type: 'shareout:page', path: 'docs/b.html' });
    expect(b.replaceState).toHaveBeenCalledWith(null, '', `${BASE}/a/demo/?page=docs%2Fb.html`);
    b.send({ type: 'shareout:open-artifact', slug: 'other' });
    expect(b.parentPosts).toEqual([]);
  });
});

describe('page agent: error reports', () => {
  const errorsPosted = (posted: unknown[]) => posted.filter((m) => (m as { type: string }).type === 'shareout:error');
  const fireError = (a: ReturnType<typeof runAgent>, e: Record<string, unknown>) => (a.fire as (t: string, e: unknown) => void)('error', e);

  it('posts an uncaught error (a SyntaxError from a later script) without the capability token', () => {
    const a = runAgent({ href: `${CDN}/c/tok123/index.html` });
    fireError(a, {
      message: 'SyntaxError: Invalid or unexpected token',
      filename: `${CDN}/c/tok123/index.html`, lineno: 125, colno: 30,
      error: { stack: `SyntaxError: Invalid or unexpected token\n    at ${CDN}/c/tok123/index.html:125:30` },
    });
    const [m] = errorsPosted(a.posted) as Array<Record<string, string>>;
    expect(m).toMatchObject({ type: 'shareout:error', kind: 'error', message: 'SyntaxError: Invalid or unexpected token', where: '/index.html:125:30', path: 'index.html' });
    expect(JSON.stringify(a.posted)).not.toContain('tok123');
    expect(JSON.stringify(a.posted)).not.toContain('cdn.example');
  });

  it('posts an unhandled rejection with the reason message', () => {
    const a = runAgent({ href: `${CDN}/index.html` });
    (a.fire as (t: string, e: unknown) => void)('unhandledrejection', { reason: new Error('HTTP 403 on insert') });
    (a.fire as (t: string, e: unknown) => void)('unhandledrejection', { reason: { code: 'FORBIDDEN' } });
    expect(errorsPosted(a.posted)).toMatchObject([
      { kind: 'rejection', message: 'HTTP 403 on insert' },
      { kind: 'rejection', message: '{"code":"FORBIDDEN"}' },
    ]);
  });

  it('dedupes, caps at 5 per page, and skips opaque or benign errors', () => {
    const a = runAgent({ href: `${CDN}/index.html` });
    fireError(a, { message: 'boom' });
    fireError(a, { message: 'boom' });
    fireError(a, { message: 'Script error.' });
    fireError(a, { message: 'ResizeObserver loop completed with undelivered notifications.' });
    for (let i = 0; i < 10; i++) fireError(a, { message: `err ${i}` });
    const msgs = errorsPosted(a.posted).map((m) => (m as { message: string }).message);
    expect(msgs).toEqual(['boom', 'err 0', 'err 1', 'err 2', 'err 3']);
  });
});

describe('viewer page bridge: error reports', () => {
  it('queues errors from its content frame and announces them; ignores other sources', () => {
    const heard = vi.fn();
    window.addEventListener('shareout:error', heard);
    const b = runBridge({ inShell: false });
    b.send({ type: 'shareout:error', kind: 'error', message: 'boom', where: '/index.html:1:2', stack: 's', path: 'index.html' }, {});
    expect(b.win.__soErrors).toEqual([]);
    b.send({ type: 'shareout:error', kind: 'weird', message: 'boom', where: '/index.html:1:2', stack: 's', path: 'index.html', extra: 1 });
    expect(b.win.__soErrors).toEqual([{ kind: 'error', message: 'boom', where: '/index.html:1:2', stack: 's', path: 'index.html' }]);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener('shareout:error', heard);
  });
});

describe('isSafePagePath', () => {
  it('accepts plain relative paths and rejects traversal and odd characters', () => {
    expect(isSafePagePath('docs/step-1.html')).toBe(true);
    expect(isSafePagePath('My Page.html')).toBe(true);
    for (const bad of ['', '/abs.html', '../x.html', 'a/../b.html', 'a//b.html', './a.html', 'a.html?x', 'a.html#y', 'a%2e.html', 'x'.repeat(513)]) {
      expect(isSafePagePath(bad), bad).toBe(false);
    }
  });
});

describe('page agent: ?section= deep links (the frame #fragment)', () => {
  // Runs the agent against the real DOM, with the frame's location carrying the hash.
  function openAt(hash: string, body: string) {
    document.body.innerHTML = body;
    const listeners: Record<string, Array<() => void>> = {};
    const on = (type: string, fn: () => void) => { (listeners[type] ||= []).push(fn); };
    const loc = { origin: CDN, pathname: '/guide.html', href: `${CDN}/guide.html${hash}`, hash };
    const parent = { postMessage: () => undefined };
    const scrolled: Element[] = [];
    const proto = window.HTMLElement.prototype as unknown as { scrollIntoView: () => void };
    const orig = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) { scrolled.push(this); };
    try {
      new Function('window', 'parent', 'location', 'addEventListener', 'document', buildPageAgent('demo', BASE, 'guide.html', 'index.html'))(
        { parent, open: vi.fn() }, parent, loc, on, document,
      );
    } finally { proto.scrollIntoView = orig; }
    return { scrolled, loc, fire: (t: string) => (listeners[t] || []).forEach((f) => f()) };
  }

  it('resolves an h- slug to the matching heading (accents folded, deduped) and highlights it', () => {
    vi.useFakeTimers();
    const r = openAt('#h-clasificacion-2', '<h1>Guía</h1><h2>Clasificación</h2><p>a</p><h2>Clasificación</h2><p id="p">b</p>');
    const target = document.querySelectorAll('h2')[1] as HTMLElement;
    expect(r.scrolled).toEqual([target]);
    expect(target.style.outline).toContain('solid');
    vi.advanceTimersByTime(4000);
    expect(target.style.outline).toBe('');
    vi.useRealTimers();
  });

  it('a real id wins over a heading whose slug matches', () => {
    const r = openAt('#h-scope', '<h2>Scope</h2><div id="h-scope">real</div>');
    expect(r.scrolled).toEqual([document.getElementById('h-scope')]);
  });

  it('plain ids are scrolled + highlighted on load; unknown or unsafe hashes do nothing', () => {
    const r = openAt('#s3', '<section id="s3"><h2>3. Waste</h2></section>');
    expect(r.scrolled).toEqual([document.getElementById('s3')]);
    expect(openAt('#h-missing', '<h2>Other</h2>').scrolled).toEqual([]);
    expect(openAt('#/route/x', '<h2>Route</h2>').scrolled).toEqual([]);
  });

  it('later in-page jumps to an h- slug resolve too (hashchange)', () => {
    const r = openAt('', '<h2>Alpha</h2><h2>Beta</h2>');
    r.loc.hash = '#h-beta';
    const proto = window.HTMLElement.prototype as unknown as { scrollIntoView: () => void };
    const orig = proto.scrollIntoView;
    const seen: Element[] = [];
    proto.scrollIntoView = function (this: Element) { seen.push(this); };
    try { r.fire('hashchange'); } finally { proto.scrollIntoView = orig; }
    expect(seen).toEqual([document.querySelectorAll('h2')[1]]);
  });

  it('the agent source is ASCII-only, so it survives pages of any charset', () => {
    expect(/^[\x00-\x7f]*$/.test(buildPageAgent('demo', BASE, 'a.html', 'index.html'))).toBe(true);
  });
});
