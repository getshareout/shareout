// @vitest-environment happy-dom
//
// The Studio never offers "Anyone with the link" when public links can't take effect:
// the create-confirm chooser and the inspector / Share popover visibility control.
import { beforeEach, describe, expect, it } from 'vitest';
import { workspace_client_tabs_JS as tabsJs } from '../../../src/pages/home/render-workspace/client-script/tabs';
import { workspace_client_inspector_JS as inspectorJs } from '../../../src/pages/home/render-workspace/client-script/inspector';
import { workspace_client_create_ai_JS as createJs } from '../../../src/pages/home/render-workspace/client-script/create-ai';
import { COMPOSER_COPY } from '../../../src/pages/home/home-i18n/copy/composer';
import { INSPECTOR_COPY } from '../../../src/pages/home/home-i18n/copy/inspector';

function load(openVis: boolean | undefined, lang: 'en' | 'es' = 'en') {
  document.body.innerHTML = '<div class="wsx" id="ws"><div id="wsxTabs"></div><div id="wsxPanes"></div><div id="wsxHomePane"></div>'
    + '<div id="wsxTabMode" hidden></div><div id="wsxRtabs"></div><div id="wsxRbody"></div>'
    + '<div id="wsxComposer" data-state="sheet"><textarea id="wsxAsk"></textarea><div id="wsxThreadList"></div></div>'
    + '<button id="wsxPill"><span class="wsx__pill-text"></span></button></div>';
  const threadList = document.getElementById('wsxThreadList')!;
  const copy = { ...(COMPOSER_COPY[lang] as Record<string, string>), ...(INSPECTOR_COPY[lang] as Record<string, string>) };
  const base: Record<string, unknown> = {
    t: (k: string) => copy[k] ?? k,
    esc: (s: unknown) => String(s ?? '').replace(/"/g, '&quot;'),
    ws: document.getElementById('ws'), composer: document.getElementById('wsxComposer'), threadList,
    pill: document.getElementById('wsxPill'), ask: document.getElementById('wsxAsk'),
    LS: { tabs: 'k' }, i18nLoad: () => '', fetchMeta: () => {}, dataClear: () => {},
    setComposer: () => {}, scrollEnd: () => {}, removeRow: () => {}, rowOf: () => null,
    addMsg: () => document.createElement('div'),
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  };
  (window as unknown as Record<string, unknown>).WSX_WS = 'wsp_1';
  (window as unknown as Record<string, unknown>).WSX_OPEN_VIS = openVis;
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
  const api = new Function('scope', `with (scope) {\n${tabsJs}\n${inspectorJs}\n${createJs}\n; return { renderConfirm: renderConfirm, visBlockHtml: visBlockHtml }; }`)(scope) as {
    renderConfirm: (c: { label: string; prompt: string }) => void;
    visBlockHtml: (editable: boolean, opts: string[], cur: string, noPub?: boolean) => string;
  };
  return { ...api, threadList };
}

const chip = (root: ParentNode, o: string) => root.querySelector(`[data-cv="${o}"]`) as HTMLButtonElement;

describe('Studio create confirm: who can see it', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('offers Anyone with the link when public links are allowed', () => {
    const h = load(true);
    h.renderConfirm({ label: 'Ready?', prompt: 'x' });
    expect(chip(h.threadList, 'public').disabled).toBe(false);
    expect(h.threadList.textContent).not.toContain('turned off');
  });

  it('treats an unknown flag as allowed (older boot script)', () => {
    const h = load(undefined);
    h.renderConfirm({ label: 'Ready?', prompt: 'x' });
    expect(chip(h.threadList, 'public').disabled).toBe(false);
  });

  it('disables it with a reason when public links are off', () => {
    const h = load(false);
    h.renderConfirm({ label: 'Ready?', prompt: 'x' });
    const pub = chip(h.threadList, 'public');
    expect(pub.disabled).toBe(true);
    expect(pub.title).toBe('Public links are turned off here.');
    expect(h.threadList.textContent).toContain('Public links are turned off here.');
    pub.click();
    expect(pub.getAttribute('aria-checked')).toBe('false');
    expect(chip(h.threadList, 'private').getAttribute('aria-checked')).toBe('true');
  });

  it('says the reason in Spanish', () => {
    const h = load(false, 'es');
    h.renderConfirm({ label: 'Listo?', prompt: 'x' });
    expect(h.threadList.textContent).toContain('Los enlaces públicos están desactivados acá.');
  });
});

describe('inspector / Share popover visibility control', () => {
  it('disables the Public option and explains why when public links are off', () => {
    const h = load(true);
    const box = document.createElement('div');
    box.innerHTML = h.visBlockHtml(true, ['private', 'workspace', 'public'], 'private', true);
    const pub = box.querySelector('[data-vis="public"]') as HTMLButtonElement;
    expect(pub.disabled).toBe(true);
    expect(pub.title).toBe('Public links are turned off here.');
    expect((box.querySelector('[data-vis="private"]') as HTMLButtonElement).disabled).toBe(false);
    expect(box.querySelector('#wsxVisSub')!.textContent).toContain('Public links are turned off here.');
  });

  it('shows it normally when allowed', () => {
    const h = load(true);
    const box = document.createElement('div');
    box.innerHTML = h.visBlockHtml(true, ['private', 'public'], 'private', false);
    expect((box.querySelector('[data-vis="public"]') as HTMLButtonElement).disabled).toBe(false);
    expect(box.querySelector('#wsxVisSub')!.textContent).not.toContain('turned off');
  });

  it('never disables the option an artifact already has', () => {
    const h = load(true);
    const box = document.createElement('div');
    box.innerHTML = h.visBlockHtml(true, ['private', 'public'], 'public', true);
    expect((box.querySelector('[data-vis="public"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
