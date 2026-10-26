// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { workspace_client_edit_lite_JS as editJs } from '../../../src/pages/home/render-workspace/client-script/edit-lite';

type Rec = { srcDoc: Document; art: { slug: string }; md: null; editframe: { srcdoc?: string; onload: unknown } };
type Api = {
  editFrameHtml: (srcDoc: Document, slug: string) => string;
  renderLive: (rec: Rec) => void;
  serializeClean: (rec: Rec) => string;
};
let api: Api;

const POLICY = "script-src 'none'; object-src 'none'; base-uri 'self'";

beforeAll(() => {
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 't') return (k: string) => k;
      if (prop === 'esc') return (s: unknown) => String(s ?? '');
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
    set: (target, prop, value) => { target[prop as string] = value; return true; },
  });
  api = new Function('scope', `with (scope) {\n${editJs}\n; return { editFrameHtml: editFrameHtml, renderLive: renderLive, serializeClean: serializeClean }; }`)(scope) as Api;
});

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

function frameDoc(source: string | Document): Document {
  const src = typeof source === 'string' ? parse(source) : source;
  return parse(api.editFrameHtml(src, 'demo'));
}

function expectPolicyFirst(doc: Document) {
  const first = doc.head.firstChild as Element;
  expect(first.nodeType).toBe(1);
  expect(first.localName).toBe('meta');
  expect(first.getAttribute('http-equiv')).toBe('Content-Security-Policy');
  expect(first.getAttribute('content')).toBe(POLICY);
  expect(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
}

describe('quick edit frame copy', () => {
  it('puts the policy first in head, then the base and edit styles, on a normal page', () => {
    const doc = frameDoc('<!doctype html><html><head><title>T</title><script src="app.js"></script></head><body><p>Hi</p><script>parent.x = 1</script></body></html>');
    expectPolicyFirst(doc);
    const [, base, style] = Array.from(doc.head.children);
    expect(base.localName).toBe('base');
    expect(base.getAttribute('href')).toBe('/a/demo/');
    expect(style.getAttribute('data-wsx-edit')).toBe('1');
    expect(doc.querySelector('title')!.textContent).toBe('T');
  });

  it('never adds the SDK script', () => {
    const html = api.editFrameHtml(parse('<html><head></head><body><p>x</p></body></html>'), 'demo');
    expect(html).not.toContain('/sdk/shareout');
  });

  it('handles a page with no <head> in its markup', () => {
    expectPolicyFirst(frameDoc('<p>Just a paragraph</p>'));
  });

  it('creates <head> when the document has none', () => {
    const src = parse('<p>x</p>');
    src.documentElement.removeChild(src.head);
    expectPolicyFirst(frameDoc(src));
  });

  it('keeps the policy first when nodes sit before <head>', () => {
    const src = parse('<!doctype html><html><!--x--><head><title>T</title></head><body><p>x</p></body></html>');
    const stray = src.createElement('div');
    stray.innerHTML = '<img src="a.png" onerror="parent.x = 1">';
    src.documentElement.insertBefore(stray, src.documentElement.firstChild);
    const html = api.editFrameHtml(src, 'demo');
    expect(html.startsWith('<!DOCTYPE html><html><head><meta ')).toBe(true);
    expectPolicyFirst(parse(html));
  });

  it('lands in <head>, not in a <header> element', () => {
    const doc = frameDoc('<header><h1>Top</h1></header><main><p>x</p></main>');
    expectPolicyFirst(doc);
    expect(doc.querySelector('header meta')).toBeNull();
    expect(doc.querySelector('header')!.firstElementChild!.localName).toBe('h1');
  });

  it('lands in the real <head>, not inside a commented-out one', () => {
    const doc = frameDoc('<!doctype html><html><!--<head>--><head><title>T</title></head><body><!--<head>--><p>x</p></body></html>');
    expectPolicyFirst(doc);
    const comments: string[] = [];
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) comments.push((walker.currentNode as Comment).data);
    expect(comments).toEqual(['<head>', '<head>']);
  });

  it('lands in the real <head> when an attribute mentions <head>', () => {
    expectPolicyFirst(frameDoc('<html data-x="<head>"><body><p title="<head>">x</p></body></html>'));
  });

  it('renders into the edit frame without touching the saved source', () => {
    const rec: Rec = {
      srcDoc: parse('<!doctype html><html><head><title>T</title></head><body><p>x</p></body></html>'),
      art: { slug: 'demo' },
      md: null,
      editframe: { onload: null },
    };
    api.renderLive(rec);
    expectPolicyFirst(parse(rec.editframe.srcdoc!));
    expect(api.serializeClean(rec)).not.toMatch(/Content-Security-Policy|data-wsx-edit|<base/i);
  });
});
