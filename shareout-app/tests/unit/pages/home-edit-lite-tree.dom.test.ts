// @vitest-environment happy-dom
//
// Quick edit: any authored element hovers/selects like the full editor, inline bits belong
// to their text, and the Editing rail lists an element tree that selects on click.
import { beforeEach, describe, expect, it } from 'vitest';
import { workspace_client_edit_lite_JS as editJs } from '../../../src/pages/home/render-workspace/client-script/edit-lite';

type Api = { pickable: (rec: unknown, n: Element) => Element | null; setSel: (rec: unknown, sel: unknown) => void; wireSubtree: (rec: unknown, root: Element) => void; wireEditDoc: (rec: unknown) => void };
let api: Api, rec: Record<string, unknown>, frame: Document, rbody: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="rbody"></div>';
  rbody = document.getElementById('rbody')!;
  frame = document.implementation.createHTMLDocument('');
  frame.body.innerHTML = '<section data-wsx-id="1"><h2 data-wsx-id="2">Title</h2><p data-wsx-id="3">Hi <b data-wsx-id="4">there</b></p></section>';
  rec = { mode: 'edit', md: null, sel: null, pendingSel: null, history: [1], editframe: { contentDocument: frame }, art: {} };
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'rbodyEl') return rbody;
      if (prop === 'panes') return { a: rec };
      if (prop === 'activeKey') return 'a';
      if (prop === 't') return (k: string) => k;
      if (prop === 'esc') return (s: unknown) => String(s ?? '');
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  api = new Function('scope', `with (scope) {\n${editJs}\n; return { pickable: pickable, setSel: setSel, wireSubtree: wireSubtree, wireEditDoc: wireEditDoc }; }`)(scope) as Api;
  api.wireEditDoc(rec);
});

const el = (id: string) => frame.querySelector(`[data-wsx-id="${id}"]`)!;

describe('quick edit element picking + tree', () => {
  it('picks containers, and maps inline bits to their text', () => {
    expect(api.pickable(rec, el('1'))).toBe(el('1'));
    expect(api.pickable(rec, el('4'))).toBe(el('3'));
  });

  it('clicking a container selects it as a block and marks it', () => {
    el('1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect((rec.sel as { type: string }).type).toBe('box');
    expect(el('1').hasAttribute('data-wsx-sel')).toBe(true);
  });

  it('the rail lists the tree; clicking a row selects that element', () => {
    const rows = [...rbody.querySelectorAll('[data-node]')].map((b) => b.getAttribute('data-node'));
    expect(rows).toEqual(['1', '2', '3']); // inline <b> belongs to its <p>
    (rbody.querySelector('[data-node="2"]') as HTMLElement).click();
    expect((rec.sel as { el: Element }).el).toBe(el('2'));
    expect(rbody.querySelector('.wsx-edit__node.is-on')!.getAttribute('data-node')).toBe('2');
  });
});
