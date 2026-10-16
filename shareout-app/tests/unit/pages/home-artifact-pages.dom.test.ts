// @vitest-environment happy-dom
//
// Multi-page artifacts in the /home shell: a stage opens on a deep-linked sub-page,
// page reports from the viewer wrapper update the pane + hash, cross-artifact links
// open tabs, and the Details page list switches pages.
import { beforeEach, describe, expect, it } from 'vitest';
import { workspace_client_tabs_JS as tabsJs } from '../../../src/pages/home/render-workspace/client-script/tabs';
import { workspace_client_artifact_pages_JS as pagesJs } from '../../../src/pages/home/render-workspace/client-script/artifact-pages';

type Rec = { iframe: HTMLIFrameElement; art: { slug: string; key: string }; page?: string; staged: boolean };
type Api = {
  openArtifactPage: (slug: string, page: string) => void;
  pagesHtml: (meta: unknown, art: { key: string }) => string;
  panes: Record<string, Rec>;
  active: () => string;
};

const STUBS = `
  function activateTab(k) { activeKey = k; if (panes[k]) loadStage(panes[k]); }
  function openArtifact(slug) {
    if (!panes[slug]) { panes[slug] = makeArtifactPane({ key: slug, id: '', slug: slug, name: slug, type: 'html' }); tabs.push({ key: slug, label: slug }); }
    activateTab(slug);
  }
  var routeApplying = false, routeLastHash = null;
  function routeFromState() { var pr = panes[activeKey]; return pr ? 'a/' + encodeURIComponent(pr.art.slug) + (pr.page ? '/' + encPage(pr.page) : '') : 'l/brief'; }
  function sec(k, l, h, b) { return '<div data-sec="' + k + '"><span class="lbl">' + l + '</span>' + b + '</div>'; }
  var rbodyEl = document.getElementById('wsxRbody');
`;

function load(): Api {
  document.body.innerHTML = '<div id="wsxTabs"></div><div id="wsxPanes"></div><div id="wsxHomePane"></div><div id="wsxRbody"></div>';
  const base: Record<string, unknown> = {
    t: (k: string) => (k === 'pages.title' ? 'Pages ({n})' : k),
    esc: (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    isvg: () => '', statsCache: {}, metaCache: {},
    fetchMeta: (_a: unknown, cb: (d: unknown) => void) => cb(null),
    setEditMode: () => {}, publishEdit: () => {}, undoEdit: () => {}, redoEdit: () => {}, discardDraft: () => {},
  };
  const scope = new Proxy({} as Record<string | symbol, unknown>, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop in base) return base[prop];
      return (globalThis as Record<string, unknown>)[prop];
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  return new Function('scope', `with (scope) {\n${STUBS}\n${tabsJs}\n${pagesJs}\n; return { openArtifactPage, pagesHtml, panes: panes, active: function () { return activeKey; } }; }`)(scope) as Api;
}

function fromStage(rec: Rec, data: unknown, origin = location.origin) {
  const win = {};
  Object.defineProperty(rec.iframe, 'contentWindow', { value: win, configurable: true });
  const ev = new MessageEvent('message', { data, origin });
  Object.defineProperty(ev, 'source', { value: win });
  window.dispatchEvent(ev);
}

beforeEach(() => { history.replaceState(null, '', '/home'); });

describe('multi-page artifacts in the shell', () => {
  it('opens a deep-linked sub-page on the first stage paint', () => {
    const api = load();
    api.openArtifactPage('manual', 'docs/step 1.html');
    const rec = api.panes.manual;
    expect(rec.iframe.getAttribute('src')).toBe('/a/manual/?wsx=1&page=docs%2Fstep%201.html');
    expect(rec.page).toBe('docs/step 1.html');
  });

  it('tracks page reports from its own stage and replaces the hash', () => {
    const api = load();
    api.openArtifactPage('manual', '');
    const rec = api.panes.manual;
    expect(rec.iframe.getAttribute('src')).toBe('/a/manual/?wsx=1');
    const before = history.length;
    fromStage(rec, { type: 'shareout:page', slug: 'manual', page: 'docs/b.html' });
    expect(rec.page).toBe('docs/b.html');
    expect(location.hash).toBe('#a/manual/docs/b.html');
    expect(history.length).toBe(before);
    // Wrong origin is ignored.
    fromStage(rec, { type: 'shareout:page', page: 'evil.html' }, 'https://evil.example');
    expect(rec.page).toBe('docs/b.html');
    fromStage(rec, { type: 'shareout:page', page: '' });
    expect(location.hash).toBe('#a/manual');
  });

  it('opens a cross-artifact link as a new tab on the requested page', () => {
    const api = load();
    api.openArtifactPage('manual', '');
    fromStage(api.panes.manual, { type: 'shareout:open-artifact', slug: 'policies', page: 'leave.html' });
    expect(api.active()).toBe('policies');
    expect(api.panes.policies.iframe.getAttribute('src')).toBe('/a/policies/?wsx=1&page=leave.html');
  });

  it('switches an open tab to another page without opening a duplicate', () => {
    const api = load();
    api.openArtifactPage('manual', '');
    api.openArtifactPage('manual', 'docs/b.html');
    expect(Object.keys(api.panes)).toEqual(['manual']);
    expect(api.panes.manual.iframe.getAttribute('src')).toBe('/a/manual/?wsx=1&page=docs%2Fb.html');
  });

  it('renders the Details page list (entry as home) and switches pages from it', () => {
    const api = load();
    api.openArtifactPage('manual', '');
    const meta = { entrypoint: 'index.html', pages: ['index.html', 'docs/a.html'] };
    expect(api.pagesHtml({ pages: ['index.html'] }, { key: 'manual' })).toBe('');
    const rbody = document.getElementById('wsxRbody')!;
    rbody.innerHTML = api.pagesHtml(meta, { key: 'manual' });
    expect(rbody.querySelector('.lbl')!.textContent).toBe('Pages (2)');
    const btns = rbody.querySelectorAll('[data-art-page]');
    expect([...btns].map((b) => b.getAttribute('data-art-page'))).toEqual(['', 'docs/a.html']);
    expect(btns[0].classList.contains('is-on')).toBe(true);
    (btns[1] as HTMLElement).click();
    expect(api.panes.manual.iframe.getAttribute('src')).toBe('/a/manual/?wsx=1&page=docs%2Fa.html');
    expect(btns[1].classList.contains('is-on')).toBe(true);
    expect(location.hash).toBe('#a/manual/docs/a.html');
  });
});
